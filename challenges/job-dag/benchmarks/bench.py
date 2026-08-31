"""Scheduling throughput on a fixed graph.

The workload is fixed by construction: the same `size` jobs and the same edges
every time, on every host, for every submission. Every job is the same no-op,
so what is measured is the scheduling -- indegrees, the ready set, the ordering
-- and not the work. Nothing here branches on what the submission returns or on
how fast it is.

Round-1 API only: run_dag, never run_dag_report, which a round-1 submission
does not have. run_dag is called positionally, exactly as the hidden suites
call it, with a plain dict of jobs and a plain dict of dependency lists.

Names are zero-padded so alphabetical order is stable and comparisons are
cheap; each job past the first depends on two earlier ones, so the ready set
stays large and the indegree bookkeeping is actually exercised.
"""
import solution

SIZES = [20_000, 80_000]


def _noop():
    pass


def setup(size):
    names = [f"j{i:06d}" for i in range(size)]
    jobs = {name: _noop for name in names}
    deps = {names[i]: ([names[0]] if i == 1 else
                       [names[i // 2], names[i // 2 - 1]])
            for i in range(1, size)}
    return jobs, deps


def run(data):
    jobs, deps = data
    solution.run_dag(jobs, deps)
