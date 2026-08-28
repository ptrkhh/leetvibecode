"""Runs inside the sandbox. Times bench.run(setup(size)) median-of-3 per size."""
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
