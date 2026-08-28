import xml.etree.ElementTree as ET

from runner import run_sandbox


def _sanitize(msg: str | None) -> str | None:
    if not msg:
        return None
    return msg.strip().splitlines()[0][:300]


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
        return parse_junit(xml), None, None
    except ET.ParseError:
        return [], "tests produced unreadable results", None
