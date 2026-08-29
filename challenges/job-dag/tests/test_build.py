import pytest

from solution import run_dag


def recorder():
    """(log, make) -- make(name) builds a job appending its own name to log.
    Duplicated verbatim in test_extend.py: each suite is handed to the sandbox
    on its own, with no conftest.py to share."""
    log = []

    def make(name, boom=None):
        def job():
            log.append(name)
            if boom is not None:
                raise boom
        return job

    return log, make


def test_linear_chain_runs_in_dependency_order():
    log, make = recorder()
    jobs = {"c": make("c"), "b": make("b"), "a": make("a")}
    assert run_dag(jobs, {"c": ["b"], "b": ["a"]}) == ["a", "b", "c"]
    assert log == ["a", "b", "c"]


def test_ready_jobs_break_ties_alphabetically():
    log, make = recorder()
    jobs = {"c": make("c"), "a": make("a"), "b": make("b")}
    assert run_dag(jobs, {}) == ["a", "b", "c"]   # not insertion order
    assert log == ["a", "b", "c"]


def test_a_newly_freed_job_beats_an_untouched_one():
    # b becomes ready the moment a finishes, and b < x, so b runs before x.
    # A level-by-level runner would emit a, x, b instead.
    log, make = recorder()
    jobs = {"a": make("a"), "b": make("b"), "x": make("x")}
    assert run_dag(jobs, {"b": ["a"]}) == ["a", "b", "x"]
    assert log == ["a", "b", "x"]


def test_diamond_runs_each_job_exactly_once():
    log, make = recorder()
    jobs = {n: make(n) for n in "abcd"}
    deps = {"b": ["a"], "c": ["a"], "d": ["b", "c"]}
    assert run_dag(jobs, deps) == ["a", "b", "c", "d"]
    assert log == ["a", "b", "c", "d"]   # a exactly once, d after BOTH b and c


def test_cycle_raises_value_error_without_running_anything():
    log, make = recorder()
    jobs = {n: make(n) for n in ("a", "b", "c", "z")}
    deps = {"a": ["c"], "b": ["a"], "c": ["b"]}   # a -> b -> c -> a, z is free
    with pytest.raises(ValueError):
        run_dag(jobs, deps)
    assert log == []   # not even the runnable z


def test_self_dependency_is_a_cycle():
    log, make = recorder()
    with pytest.raises(ValueError):
        run_dag({"a": make("a")}, {"a": ["a"]})
    assert log == []


def test_absent_and_empty_dependency_lists_both_mean_none():
    # "a" carries an empty list and "c" is missing from deps entirely; both
    # are free to run immediately, and a runner that reads mere presence in
    # deps as "has dependencies" strands a forever.
    log, make = recorder()
    jobs = {"a": make("a"), "b": make("b"), "c": make("c")}
    assert run_dag(jobs, {"a": [], "b": ["c"]}) == ["a", "c", "b"]
    assert log == ["a", "c", "b"]


def test_a_failing_job_propagates_and_stops_the_run():
    log, make = recorder()
    boom = RuntimeError("disk full")
    jobs = {"a": make("a"), "b": make("b", boom), "c": make("c")}
    with pytest.raises(RuntimeError):
        run_dag(jobs, {"c": ["b"]})
    assert log == ["a", "b"]   # a ran, b blew up, c never started
