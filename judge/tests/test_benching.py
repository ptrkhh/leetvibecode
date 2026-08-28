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
    solution.spin(1.2 if _n[0] == 1 else 0.0)
"""


@pytest.mark.docker
def test_bench_uses_median_of_three_not_mean():
    # bench.py's run() sleeps 1.2s on the FIRST of the 3 real iterations for
    # this size and ~0s on the other two (a module-level counter proves all
    # three iterations actually execute, not one measurement reused).
    # median([~1200, ~0, ~0]) ~= a few ms; mean of the same three would be
    # ~400ms. Asserting well under the mean-only value proves the reported
    # time is the median of three real timed iterations, not their mean and
    # not a single iteration's time.
    solution_code = "import time\ndef spin(seconds):\n    if seconds:\n        time.sleep(seconds)\n"
    rows, sub_err, plat_err = run_bench(solution_code, MEDIAN_BENCH)
    assert sub_err is None and plat_err is None
    assert rows[0]["timeMs"] < 150
