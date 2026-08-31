"""Runs inside the sandbox. Benchmarks a challenge's bench.py.

Contract bench.py must satisfy (module-level):
    SIZES: list[int]     -- input sizes to benchmark, in report order.
                             No duplicates (a consumer may key rows by
                             inputSize, and a duplicate silently collapses
                             two of them into one). Not empty -- an empty
                             SIZES is accepted and produces a clean empty
                             result, indistinguishable from a
                             misconfigured challenge, so don't ship one.
    setup(size) -> data   -- builds one iteration's input. NOT timed.
    run(data) -> None     -- does the timed work; must import `solution`
                             itself (this harness never imports it). Its
                             return value is ignored. Must do equivalent
                             work on every call for a given `data` --
                             unseeded randomness, or any accumulator that
                             grows call-over-call, skews which of the 3
                             iterations looks fastest/slowest and makes
                             the reported median meaningless.

Only run(data) is timed, and its median over 3 iterations is what gets
reported (to suppress scheduler noise). For each size, setup(size) is
called fresh before EVERY one of the 3 iterations -- so one run() can
never see data another iteration already mutated -- but setup's own cost,
though never scored, still runs inside this phase's single fixed 30s
wall-clock budget (enforced by the sandbox runner, not by this script).
A bench.py's true wall-clock is therefore 3 x (setup(size) + run(data))
summed over every size in SIZES, even though only the run() portions are
ever reported -- not 30s per size, and not 30s per run() call. Pick
SIZES (and keep setup cheap) with that sum in mind, not just each run()'s
own cost.

memoryMb is resource.getrusage(RUSAGE_SELF).ru_maxrss -- the process's
peak resident set size since it started, not this size's own usage. It is
sampled once per size, after that size's 3 iterations, but the number it
reports is a whole-process high-water mark: across multiple entries in
SIZES, a later row's memoryMb can never be lower than an earlier row's,
regardless of that size's real memory use. Treat it as a monotonic
peak-so-far proxy, not a per-size measurement.
"""
import json
import resource
import statistics
import time

import bench


def main():
    out = []
    for size in bench.SIZES:
        times = []
        for _ in range(3):
            data = bench.setup(size)
            t0 = time.perf_counter()
            bench.run(data)
            times.append((time.perf_counter() - t0) * 1000)
        mem_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
        out.append({"inputSize": size, "timeMs": statistics.median(times),
                    "memoryMb": round(mem_mb, 1), "timedOut": False})
    with open("/work/bench.json", "w") as f:
        json.dump(out, f)


main()
