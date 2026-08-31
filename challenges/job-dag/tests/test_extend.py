import pytest

import solution
from solution import run_dag

# run_dag_report is reached through the module, never imported by name at the
# top of the file. A round-2 answer that forgets to add it must fail only the
# tests that call it: a module-level `from solution import run_dag_report`
# raises during COLLECTION, and pytest then abandons the whole run -- including
# test_build.py, which round 2 runs in the same invocation -- so forgetting one
# function would wipe out the build-suite score that measures extensibility.


def recorder():
    """(log, make) -- make(name) builds a job appending its own name to log.
    Duplicated verbatim in test_build.py: each suite is handed to the sandbox
    on its own, with no conftest.py to share."""
    log = []

    def make(name, boom=None):
        def job():
            log.append(name)
            if boom is not None:
                raise boom
        return job

    return log, make


def test_report_is_all_ok_for_a_healthy_dag():
    log, make = recorder()
    jobs = {"a": make("a"), "b": make("b"), "x": make("x")}
    assert solution.run_dag_report(jobs, {"b": ["a"]}) == {"a": "ok", "b": "ok", "x": "ok"}
    assert log == ["a", "b", "x"]   # same order run_dag would have used


def test_a_failed_job_skips_its_dependents_transitively():
    log, make = recorder()
    jobs = {"a": make("a", RuntimeError("boom")), "b": make("b"),
            "c": make("c"), "d": make("d")}
    assert solution.run_dag_report(jobs, {"b": ["a"], "c": ["b"]}) == {
        "a": "failed", "b": "skipped", "c": "skipped", "d": "ok"}
    assert log == ["a", "d"]   # b and c were never called at all


def test_a_job_is_skipped_when_any_dependency_did_not_succeed():
    log, make = recorder()
    jobs = {"a": make("a", ValueError("boom")), "x": make("x"), "z": make("z")}
    assert solution.run_dag_report(jobs, {"z": ["a", "x"]}) == {
        "a": "failed", "x": "ok", "z": "skipped"}
    assert log == ["a", "x"]   # the healthy branch still ran


def test_report_refuses_a_cycle_without_running_anything():
    log, make = recorder()
    jobs = {n: make(n) for n in ("a", "b", "c", "z")}
    with pytest.raises(ValueError):
        solution.run_dag_report(jobs, {"a": ["c"], "b": ["a"], "c": ["b"]})
    assert log == []


def test_run_dag_is_unchanged():
    log, make = recorder()
    jobs = {"a": make("a"), "b": make("b"), "x": make("x")}
    assert run_dag(jobs, {"b": ["a"]}) == ["a", "b", "x"]
    assert log == ["a", "b", "x"]

    log2, make2 = recorder()
    jobs2 = {"a": make2("a", RuntimeError("boom")), "b": make2("b")}
    with pytest.raises(RuntimeError):
        run_dag(jobs2, {"b": ["a"]})   # still raises; it did NOT become a report
    assert log2 == ["a"]
