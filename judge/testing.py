import re
import xml.etree.ElementTree as ET

from runner import run_sandbox

# R34: mirrors pytest's own default collection rule (test_*.py / def test_*)
# so the expected-name set below reflects what an honest run would produce.
_TEST_DEF_RE = re.compile(r"^\s*def (test_\w+)", re.MULTILINE)


def _sanitize(msg: str | None) -> str | None:
    if not msg:
        return None
    # R35: a whitespace-only message strips to "", whose splitlines() is []
    # -- indexing [0] into that raised an uncaught IndexError. Any string
    # input must produce a result, never crash.
    lines = msg.strip().splitlines()
    return lines[0][:300] if lines else None


def parse_junit(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    out = []
    for case in root.iter("testcase"):
        # explicit None checks: ElementTree elements are falsy when childless,
        # so `find(...) or find(...)` would silently mis-detect failures
        bad = next((e for tag in ("failure", "error", "skipped")
                    if (e := case.find(tag)) is not None), None)
        out.append({
            "name": f"{case.get('classname', '')}::{case.get('name', '')}",
            "passed": bad is None,
            "message": _sanitize(bad.get("message") if bad is not None else None),
            "runtimeMs": float(case.get("time", 0)) * 1000,
        })
    return out


def run_tests(code: str, test_files: dict[str, str]):
    files = {"solution.py": code, **test_files}
    cmd = ["python", "-m", "pytest", *test_files.keys(), "--junit-xml=/work/result.xml", "-q"]
    # R33: keep=("result.xml",) exempts it from the combined output-size cap
    # -- without it, junk written into /work could crowd result.xml out of
    # r.files, and the missing-xml branch below would then read that as "no
    # output produced", manufacturing a submission fault against a player
    # whose real output was tiny.
    r = run_sandbox(files, cmd, timeout_s=30, keep=("result.xml",))
    if r.platform_error:
        return [], None, r.platform_error
    if r.timed_out:
        return [], "test phase timed out (30s)", None
    xml = r.files.get("result.xml")
    if not xml:
        return [], "tests could not run (import or collection crash)", None
    try:
        results = parse_junit(xml)
    except Exception:
        # R35: was `except ET.ParseError` -- too narrow. result.xml is
        # untrusted content (hostile OR just corrupted); any way parsing it
        # blows up (e.g. a non-numeric time="abc" raising ValueError) must
        # land here as a submission_error, not escape and crash the judge.
        return [], "tests produced unreadable results", None

    # R34: result.xml is written INSIDE the sandbox by the same process (and
    # uid) as the player's own code -- hidden tests reach solution.py via
    # `import solution`, so solution.py's MODULE-LEVEL code runs during
    # pytest's own collection, before pytest's writer does. A submission can
    # pre-write an all-passing result.xml and os._exit(0) before that writer
    # ever runs, forging a perfect score for provably wrong code (reproduced
    # live; see task-8-report.md). These two checks are defense-in-depth
    # against the NAIVE version of that attack -- an implausible exit code,
    # or claiming results for tests that don't match what was actually
    # asked for.
    # ponytail: does NOT close the hole. The sandbox files (test source
    # included) are readable by the player's own code before this runs, so
    # a determined attacker reads the real test names in-sandbox and forges
    # a matching set. Closing that needs the judge to authenticate the
    # result from OUTSIDE the container (observed behaviour, not a trusted
    # artifact) or run harness/payload under different uids -- an
    # architectural change, not a fix here.
    all_passed = all(row["passed"] for row in results)
    if all_passed != (r.exit_code == 0):
        return [], "tests produced inconsistent results", None
    expected = set()
    for content in test_files.values():
        expected.update(_TEST_DEF_RE.findall(content))
    got = {row["name"].rsplit("::", 1)[-1] for row in results}
    if got != expected:
        return [], "tests produced unexpected results", None
    return results, None, None
