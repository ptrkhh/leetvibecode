import json
import pathlib

import pytest

import publish_check
from publish_check import check


def write_challenge(root, solution_body):
    ch = root / "adder"
    (ch / "reference").mkdir(parents=True)
    (ch / "tests").mkdir()
    (ch / "benchmarks").mkdir()
    (ch / "challenge.yaml").write_text("slug: adder\n")
    (ch / "reference" / "solution.py").write_text(solution_body)
    (ch / "tests" / "test_build.py").write_text(
        "from solution import add\ndef test_a():\n    assert add(1, 2) == 3\n")
    (ch / "tests" / "test_extend.py").write_text(
        "from solution import add\ndef test_b():\n    assert add(-1, 1) == 0\n")
    (ch / "benchmarks" / "bench.py").write_text(
        "import solution\nSIZES=[100]\n"
        "def setup(s):\n    return list(range(s))\n"
        "def run(d):\n    [solution.add(x, 1) for x in d]\n")
    return ch


GOOD_ADD = "def add(a, b):\n    return a + b\n"

FAKE_PASSING_RESULTS = [
    {"name": "test_build::test_a", "passed": True, "message": None, "runtimeMs": 1.0},
    {"name": "test_extend::test_b", "passed": True, "message": None, "runtimeMs": 1.0},
]


# ---- happy path + refusal (Docker: runs the reference for real) ----

@pytest.mark.docker
def test_good_reference_writes_lock(tmp_path):
    ch = write_challenge(tmp_path, GOOD_ADD)
    assert check(ch) == 0
    lock = json.loads((ch / "challenge.lock.json").read_text())
    assert lock["referenceMs"] > 0


@pytest.mark.docker
def test_failing_reference_refused(tmp_path):
    ch = write_challenge(tmp_path, "def add(a, b):\n    return 0\n")
    assert check(ch) == 1
    assert not (ch / "challenge.lock.json").exists()


@pytest.mark.docker
def test_failures_from_both_suites_reported(tmp_path, capsys):
    # a reference wrong enough to fail BOTH suites' tests at once must
    # report both in the one run, not just whichever pytest lists first.
    ch = write_challenge(tmp_path, "def add(a, b):\n    return 999\n")
    assert check(ch) == 1
    out = capsys.readouterr().out
    assert "test_a" in out
    assert "test_b" in out
    assert not (ch / "challenge.lock.json").exists()


@pytest.mark.docker
def test_empty_sizes_refused(tmp_path):
    # R: run_bench returns rows=[] as a CLEAN success when SIZES is empty --
    # sum([]) == 0 would write referenceMs=0, making every submission's
    # min(1, 0/t) == 0 forever. Must be refused, not silently published.
    ch = write_challenge(tmp_path, GOOD_ADD)
    (ch / "benchmarks" / "bench.py").write_text(
        "import solution\nSIZES=[]\n"
        "def setup(s):\n    return None\n"
        "def run(d):\n    pass\n")
    assert check(ch) == 1
    assert not (ch / "challenge.lock.json").exists()


# ---- platform_error must never be reported as a bad challenge (no Docker: mocked) ----

def test_platform_error_in_tests_distinguished(tmp_path, monkeypatch, capsys):
    ch = write_challenge(tmp_path, GOOD_ADD)
    monkeypatch.setattr(publish_check, "run_tests",
                         lambda code, suites: ([], None, "sandbox infrastructure failure: boom"))
    assert check(ch) == 1
    out = capsys.readouterr().out
    assert "PLATFORM ERROR" in out
    assert "REFUSED" not in out
    assert not (ch / "challenge.lock.json").exists()


def test_platform_error_in_bench_distinguished(tmp_path, monkeypatch, capsys):
    ch = write_challenge(tmp_path, GOOD_ADD)
    monkeypatch.setattr(publish_check, "run_tests",
                         lambda code, suites: (FAKE_PASSING_RESULTS, None, None))
    monkeypatch.setattr(publish_check, "run_bench",
                         lambda code, bench_py: ([], None, "sandbox infrastructure failure: boom"))
    assert check(ch) == 1
    out = capsys.readouterr().out
    assert "PLATFORM ERROR" in out
    assert "REFUSED" not in out
    assert not (ch / "challenge.lock.json").exists()


# ---- malformed challenge directory: clean refusal, never a traceback (no Docker) ----

def test_missing_challenge_yaml_refused(tmp_path, capsys):
    ch = write_challenge(tmp_path, GOOD_ADD)
    (ch / "challenge.yaml").unlink()
    assert check(ch) == 1
    assert "challenge.yaml" in capsys.readouterr().out
    assert not (ch / "challenge.lock.json").exists()


def test_missing_reference_solution_refused(tmp_path, capsys):
    ch = write_challenge(tmp_path, GOOD_ADD)
    (ch / "reference" / "solution.py").unlink()
    assert check(ch) == 1
    assert "solution.py" in capsys.readouterr().out
    assert not (ch / "challenge.lock.json").exists()


def test_missing_suite_refused(tmp_path, capsys):
    ch = write_challenge(tmp_path, GOOD_ADD)
    (ch / "tests" / "test_extend.py").unlink()
    assert check(ch) == 1
    assert "test_extend.py" in capsys.readouterr().out
    assert not (ch / "challenge.lock.json").exists()


def test_unreadable_bench_refused(tmp_path, capsys):
    ch = write_challenge(tmp_path, GOOD_ADD)
    (ch / "benchmarks" / "bench.py").unlink()
    (ch / "benchmarks" / "bench.py").mkdir()  # portable "unreadable" -- no chmod/root issues
    assert check(ch) == 1
    assert "bench.py" in capsys.readouterr().out
    assert not (ch / "challenge.lock.json").exists()


def test_non_utf8_file_refused_not_traceback(tmp_path, capsys):
    # UnicodeDecodeError is not an OSError -- a distinct way a required file
    # can be "unreadable" that a naive except OSError would miss and let
    # escape check() as a raw traceback instead of a clean refusal.
    ch = write_challenge(tmp_path, GOOD_ADD)
    (ch / "benchmarks" / "bench.py").write_bytes(b"\xff\xfe garbage, not utf-8\n")
    assert check(ch) == 1
    assert "bench.py" in capsys.readouterr().out
    assert not (ch / "challenge.lock.json").exists()


def test_multiple_missing_files_all_reported(tmp_path, capsys):
    # mirrors the both-suites ruling: an author fixing a challenge wants to
    # see every missing piece in one run, not rediscover them one at a time.
    ch = write_challenge(tmp_path, GOOD_ADD)
    (ch / "challenge.yaml").unlink()
    (ch / "benchmarks" / "bench.py").unlink()
    assert check(ch) == 1
    out = capsys.readouterr().out
    assert "challenge.yaml" in out
    assert "bench.py" in out
    assert not (ch / "challenge.lock.json").exists()
