"""CI gate for hand-authored challenges. Runs a challenge's own reference
solution against its hidden suites and benchmark, and -- only if both pass
cleanly -- writes challenge.lock.json with referenceMs, the denominator of
every player's performance score for that challenge:
    Performance = min(1, reference_time / submission_time)
A wrong or missing referenceMs silently mis-scores every attempt at that
challenge, forever, so this is the only thing standing between a broken
challenge and the leaderboard (the seed task refuses to publish without the
lock file this script writes).

Usage: python publish_check.py <challenge-dir>
Exit 0 on success (challenge.lock.json written). Exit 1 with a reason
printed otherwise -- either the challenge is bad (REFUSED) or the judge
itself couldn't run the check (PLATFORM ERROR); these are never conflated,
so an author never chases a phantom content bug caused by a Docker hiccup.
"""
import json
import pathlib
import sys

from benching import run_bench
from testing import run_tests


def _need(path: pathlib.Path) -> str | None:
    """Read one required challenge file. Returns its text, or None after
    printing a REFUSED line naming exactly what's wrong (missing, a
    directory, unreadable, ...) -- never lets a raw traceback reach the
    author running this from the CLI."""
    try:
        return path.read_text()
    except OSError as e:
        print(f"REFUSED: cannot read {path} ({e})")
        return None


def check(challenge_dir: pathlib.Path) -> int:
    # Every missing/unreadable piece is checked (not short-circuited) so a
    # malformed directory gets ALL its problems reported in one run, same
    # reasoning as running both hidden suites together below.
    yaml_path = challenge_dir / "challenge.yaml"
    yaml_ok = yaml_path.exists()
    if not yaml_ok:
        print(f"REFUSED: missing {yaml_path}")

    code = _need(challenge_dir / "reference" / "solution.py")
    build = _need(challenge_dir / "tests" / "test_build.py")
    extend = _need(challenge_dir / "tests" / "test_extend.py")
    bench_py = _need(challenge_dir / "benchmarks" / "bench.py")
    if not yaml_ok or None in (code, build, extend, bench_py):
        return 1

    # Both hidden suites in ONE run_tests call: pytest collects and reports
    # test_build.py and test_extend.py together, so a reference that fails
    # cases in both shows up as one combined failure list below -- an
    # author fixing it sees everything wrong at once, not just the first
    # suite, then reruns to discover the second.
    suites = {"test_build.py": build, "test_extend.py": extend}
    results, sub_err, plat_err = run_tests(code, suites)
    if plat_err:
        # The judge itself broke (Docker/sandbox infra) -- not a verdict on
        # the challenge's content. Must never be printed as "REFUSED".
        print(f"PLATFORM ERROR: reference test phase could not run ({plat_err})")
        return 1
    if sub_err or not results or not all(t["passed"] for t in results):
        failed = [t["name"] for t in results if not t["passed"]]
        print(f"REFUSED: reference does not pass its own suites ({sub_err or failed})")
        return 1

    rows, sub_err, plat_err = run_bench(code, bench_py)
    if plat_err:
        print(f"PLATFORM ERROR: reference benchmark could not run ({plat_err})")
        return 1
    if sub_err or any(r["timedOut"] for r in rows):
        print(f"REFUSED: reference benchmark failed ({sub_err or 'timed out'})")
        return 1
    if not rows:
        # run_bench returns rows=[] as a CLEAN success when bench.py's SIZES
        # is empty -- sum([]) is 0, and a referenceMs of 0 would make every
        # submission's min(1, 0/t) == 0 forever. That's not a benchmark that
        # passed with nothing to report; it's a misconfigured challenge.
        print(f"REFUSED: benchmark defines no SIZES ({challenge_dir / 'benchmarks' / 'bench.py'})")
        return 1

    # referenceMs is the sum of each SIZES entry's median-of-3 timeMs (the
    # bench phase already computed the median; this just totals the sizes).
    reference_ms = sum(r["timeMs"] for r in rows)
    (challenge_dir / "challenge.lock.json").write_text(
        json.dumps({"referenceMs": reference_ms}, indent=2))
    print(f"OK: referenceMs={reference_ms:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(check(pathlib.Path(sys.argv[1])))
