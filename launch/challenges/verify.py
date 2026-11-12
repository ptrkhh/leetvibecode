"""Challenge check: every reference solution must pass its own tests and benchmark.

Run with: python3 challenges/verify.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT))
import harness  # noqa: E402

failed = False
for folder in sorted(p for p in ROOT.iterdir() if (p / "reference.py").exists()):
    read = lambda name: (folder / name).read_text()
    suites = [{"name": "build", "src": read("test_build.py")}, {"name": "extend", "src": read("test_extend.py")}]
    base = {"suites": suites, "bench": read("bench.py"), "reference": read("reference.py")}

    good = harness.run({**base, "code": read("reference.py")})
    bad = harness.run({**base, "code": "x = 1"})
    broken = harness.run({**base, "code": "def oops(:"})

    problems = [f"{t['suite']}.{t['name']}: {t['message']}" for t in good["tests"] if not t["passed"]]
    if good["load_error"] or good["bench_error"] or good["sub_ms"] is None:
        problems.append(f"reference did not run cleanly: {good['load_error'] or good['bench_error']}")
    if len(good["tests"]) < 5:
        problems.append("fewer than 5 tests found")
    if any(t["passed"] for t in bad["tests"]):
        problems.append("an empty submission passed a test")
    if not broken["load_error"] or any(t["passed"] for t in broken["tests"]):
        problems.append("a syntax error was not reported as a load error")

    failed = failed or bool(problems)
    print(f"{'FAIL' if problems else 'ok  '} {folder.name}: {len(good['tests'])} tests, reference {good['ref_ms']:.0f} ms")
    for problem in problems:
        print("     ", problem)

sys.exit(1 if failed else 0)
