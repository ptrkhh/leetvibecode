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
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            raise ValueError("bench.json must be a JSON list")
        # R41: json.loads succeeding is not enough -- bench.json is
        # attacker-controlled by the same primitive as the R34 forgery, so a
        # well-formed-JSON-but-wrong-shape payload (a bare scalar, a list of
        # non-dicts, a dict missing a required key, ...) must not be handed
        # back verbatim to a caller trusting the documented list[dict]
        # contract. Reshape into exactly that contract from named lookups;
        # any row that can't supply all four keys raises here (KeyError on a
        # missing key, TypeError on a non-dict element, ValueError on a
        # non-coercible value) and is caught below, same as malformed JSON.
        rows = [{
            "inputSize": int(row["inputSize"]),
            "timeMs": float(row["timeMs"]),
            "memoryMb": None if row["memoryMb"] is None else float(row["memoryMb"]),
            "timedOut": bool(row["timedOut"]),
        } for row in parsed]
    except Exception:
        # R38/R41: bench.json is untrusted content (hostile OR just
        # corrupted) -- any way it fails to parse OR fails to match the row
        # contract must land here as a submission_error, not escape and
        # crash the judge (or a downstream caller trusting the contract).
        # Mirrors testing.py's R35 guard around parse_junit.
        return [{"inputSize": 0, "timeMs": 0, "memoryMb": None, "timedOut": True}], "benchmark produced unreadable results", None
    return rows, None, None
