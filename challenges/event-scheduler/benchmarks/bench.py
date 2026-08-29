"""Benchmark: registering events and draining them once they are all due.

The workload is fixed by construction, not emergent. The event times are
built deterministically in setup(), every event is one-shot, and the single
run_due() call passes a time later than all of them -- so every submission
schedules exactly `size` events and runs exactly `size` of them, on every
host. Nothing branches on wall time, on the host's speed, or on the
submission's own behaviour.

The scheduler is constructed and driven exactly as the hidden suites do it:
Scheduler() with no arguments, schedule(at, fn) positionally, run_due(now).
"""
import solution

SIZES = [10_000, 40_000]


def _noop():
    pass


def setup(size):
    # Deterministic, badly ordered arrival times so the ordering structure
    # actually has to do work; 7919 is coprime with every size used here.
    return [((i * 7919) % size) * 0.5 for i in range(size)]


def run(times):
    scheduler = solution.Scheduler()
    for at in times:
        scheduler.schedule(at, _noop)
    scheduler.run_due(1e9)
