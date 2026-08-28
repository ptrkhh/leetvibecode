import json
import pathlib

from runner import run_sandbox

HARNESS = (pathlib.Path(__file__).parent / "bench_harness.py").read_text()


def run_bench(code: str, bench_py: str):
    files = {"solution.py": code, "bench.py": bench_py, "bench_harness.py": HARNESS}
    # R33: keep=("bench.json",) exempts it from the combined output-size cap
    # -- without it, junk written into /work could crowd bench.json out of
    # r.files, and the missing-json branch below would then read that as "no
    # output produced", manufacturing a submission fault against a player
    # whose real output was tiny.
    r = run_sandbox(files, ["python", "bench_harness.py"], timeout_s=30, keep=("bench.json",))
    if r.platform_error:
        return [], None, r.platform_error
    if r.timed_out:
        # a fresh dict every call -- never hand back a shared mutable row
        return [{"inputSize": 0, "timeMs": 0, "memoryMb": None, "timedOut": True}], "benchmark timed out (30s)", None
    raw = r.files.get("bench.json")
    if not raw:
        return [{"inputSize": 0, "timeMs": 0, "memoryMb": None, "timedOut": True}], "benchmark crashed", None
    try:
        return json.loads(raw), None, None
    except Exception:
        # R38: bench.json is untrusted content (hostile OR just corrupted) --
        # any way parsing it blows up must land here as a submission_error,
        # not escape and crash the judge. Mirrors testing.py's R35 guard
        # around parse_junit.
        return [{"inputSize": 0, "timeMs": 0, "memoryMb": None, "timedOut": True}], "benchmark produced unreadable results", None
