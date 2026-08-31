import pytest

import runner
import benching
from benching import run_bench

BENCH = """import solution
SIZES = [100, 1000]
def setup(size):
    return list(range(size))
def run(data):
    solution.total(data)
"""


def test_run_bench_platform_error_is_not_converted_to_submission_error(monkeypatch):
    # Task 7's run_sandbox distinguishes a judge/Docker malfunction
    # (platform_error, excluded from ranking) from the player's own fault
    # (submission_error, scores 0 but stays ranked). run_bench must preserve
    # that split, not fold a platform_error into submission_error. Pure --
    # no daemon needed, mirrors testing.py's analogous test.
    def fake_run_sandbox(files, cmd, timeout_s=30, keep=()):
        return runner.SandboxResult(-1, False, {}, "sandbox infrastructure failure: boom")

    monkeypatch.setattr(benching, "run_sandbox", fake_run_sandbox)
    rows, sub_err, plat_err = run_bench("code", BENCH)
    assert rows == []
    assert sub_err is None
    assert plat_err == "sandbox infrastructure failure: boom"


def test_run_bench_malformed_json_becomes_submission_error(monkeypatch):
    # R38: bench.json is untrusted content (hostile OR just corrupted) --
    # json.loads blowing up on it must land here as a submission_error, not
    # escape run_bench uncaught. Mirrors testing.py's R35 guard around
    # parse_junit. Pure -- no daemon needed (the reviewer's live repro
    # against the real sandbox, a solution.py writing "not valid json {{{"
    # then os._exit(0), is reproduced here via the same fake bench.json
    # content instead of a live container).
    def fake_run_sandbox(files, cmd, timeout_s=30, keep=()):
        return runner.SandboxResult(0, False, {"bench.json": "not valid json {{{"}, None)

    monkeypatch.setattr(benching, "run_sandbox", fake_run_sandbox)
    rows, sub_err, plat_err = run_bench("code", BENCH)
    assert rows == [{"inputSize": 0, "timeMs": 0, "memoryMb": None, "timedOut": True}]
    assert sub_err
    assert plat_err is None


def test_run_bench_scalar_json_becomes_submission_error(monkeypatch):
    # R41: json.loads("42") succeeds -- it's valid JSON -- but yields an int,
    # not a list[dict]. R38's guard only covers json.loads RAISING; passing
    # this through verbatim would violate run_bench's own documented
    # list[dict] return contract for any real consumer.
    def fake_run_sandbox(files, cmd, timeout_s=30, keep=()):
        return runner.SandboxResult(0, False, {"bench.json": "42"}, None)

    monkeypatch.setattr(benching, "run_sandbox", fake_run_sandbox)
    rows, sub_err, plat_err = run_bench("code", BENCH)
    assert rows == [{"inputSize": 0, "timeMs": 0, "memoryMb": None, "timedOut": True}]
    assert sub_err
    assert plat_err is None


def test_run_bench_list_of_non_dicts_becomes_submission_error(monkeypatch):
    # R41: a well-formed JSON list whose elements aren't row dicts at all.
    def fake_run_sandbox(files, cmd, timeout_s=30, keep=()):
        return runner.SandboxResult(0, False, {"bench.json": "[1, 2, 3]"}, None)

    monkeypatch.setattr(benching, "run_sandbox", fake_run_sandbox)
    rows, sub_err, plat_err = run_bench("code", BENCH)
    assert rows == [{"inputSize": 0, "timeMs": 0, "memoryMb": None, "timedOut": True}]
    assert sub_err
    assert plat_err is None


def test_run_bench_dict_missing_required_key_becomes_submission_error(monkeypatch):
    # R41: a list of real dicts, but one is missing a documented key
    # (memoryMb) -- passing it through would KeyError in any consumer that
    # reads row["memoryMb"].
    forged = '[{"inputSize": 100, "timeMs": 1.0, "timedOut": false}]'

    def fake_run_sandbox(files, cmd, timeout_s=30, keep=()):
        return runner.SandboxResult(0, False, {"bench.json": forged}, None)

    monkeypatch.setattr(benching, "run_sandbox", fake_run_sandbox)
    rows, sub_err, plat_err = run_bench("code", BENCH)
    assert rows == [{"inputSize": 0, "timeMs": 0, "memoryMb": None, "timedOut": True}]
    assert sub_err
    assert plat_err is None


@pytest.mark.docker
def test_bench_reports_median_rows_per_size():
    rows, sub_err, plat_err = run_bench("def total(xs):\n    return sum(xs)\n", BENCH)
    assert sub_err is None and plat_err is None
    assert [r["inputSize"] for r in rows] == [100, 1000]
    assert all(r["timeMs"] >= 0 and not r["timedOut"] for r in rows)


@pytest.mark.docker
def test_bench_timeout_marks_timed_out():
    rows, sub_err, plat_err = run_bench(
        "def total(xs):\n    while True: pass\n", BENCH)
    assert rows == [{"inputSize": 0, "timeMs": 0, "memoryMb": None, "timedOut": True}]
    assert sub_err and plat_err is None


SETUP_SLOW_BENCH = """import solution
import time
SIZES = [1]
def setup(size):
    time.sleep(0.5)
    return None
def run(data):
    solution.noop()
"""


@pytest.mark.docker
def test_bench_timed_region_excludes_setup():
    # setup() sleeps 0.5s on every one of the 3 iterations; run() is a no-op.
    # A harness that (wrongly) started the clock before calling setup(), or
    # included setup() in the timed span at all, would report timeMs in the
    # hundreds of ms. Asserting well below that proves the clock starts
    # after setup() returns and stops right after run() -- setup cost never
    # leaks into the reported time.
    rows, sub_err, plat_err = run_bench("def noop():\n    pass\n", SETUP_SLOW_BENCH)
    assert sub_err is None and plat_err is None
    assert rows[0]["timeMs"] < 100  # real run() cost is microseconds; setup's 500ms must not show up


MEDIAN_BENCH = """import solution
SIZES = [1]
_n = [0]
def setup(size):
    return None
def run(data):
    _n[0] += 1
    n = _n[0]
    solution.spin(1.2 if n == 1 else 0.03 if n == 2 else 0.0)
"""


@pytest.mark.docker
def test_bench_uses_median_of_three_not_mean():
    # R39: the three real iterations for this size get three DISTINCT
    # durations (~1200ms, ~30ms, ~0ms -- a module-level counter proves all
    # three genuinely ran, not one measurement reused), so median (~30ms),
    # min (~0ms) and mean (~410ms) are all different values. An earlier
    # version of this test used [~1200, ~0, ~0], where min == median --
    # the reviewer proved that version passed even with statistics.median
    # swapped for min() in the harness, i.e. it couldn't actually catch a
    # regression to min(). The tight window below sits around the expected
    # median only: min's ~0ms falls below it, mean's ~410ms falls above it.
    solution_code = "import time\ndef spin(seconds):\n    if seconds:\n        time.sleep(seconds)\n"
    rows, sub_err, plat_err = run_bench(solution_code, MEDIAN_BENCH)
    assert sub_err is None and plat_err is None
    assert 20 <= rows[0]["timeMs"] <= 100
