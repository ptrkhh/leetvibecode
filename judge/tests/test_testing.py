import pytest

import runner
import testing
from testing import parse_junit, run_tests

JUNIT = """<?xml version="1.0"?>
<testsuites><testsuite name="pytest">
<testcase classname="test_x" name="test_ok" time="0.01"/>
<testcase classname="test_x" name="test_bad" time="0.02">
  <failure message="assert 1 == 2">line1
line2 with /secret/path</failure>
</testcase>
<testcase classname="test_x" name="test_skip" time="0"><skipped/></testcase>
</testsuite></testsuites>"""


def test_parse_junit_names_pass_fail_and_sanitized_message():
    rows = parse_junit(JUNIT)
    by = {r["name"]: r for r in rows}
    assert by["test_x::test_ok"]["passed"] is True
    assert by["test_x::test_bad"]["passed"] is False
    assert by["test_x::test_bad"]["message"] == "assert 1 == 2"
    assert "\n" not in by["test_x::test_bad"]["message"]
    assert by["test_x::test_skip"]["passed"] is False  # skipped = failed, conservative


def test_parse_junit_sanitizes_hostile_multiline_message():
    # Anti-leak boundary: a submission could raise an exception whose message
    # tries to smuggle hidden-test content past a naive truncation -- e.g. a
    # long first line to blow past a length cap, or secret content stashed on
    # a later line hoping only "the message" gets checked. `&#10;` is a real
    # embedded newline in the parsed attribute value (a *literal* newline in
    # the XML source normalizes to a space per the XML spec, so it wouldn't
    # actually exercise this path -- confirmed against ElementTree directly).
    first_line = "A" * 400
    secret = "SECRET_HIDDEN_TEST_CONTENT_LEAK"
    xml = (
        '<?xml version="1.0"?>'
        '<testsuites><testsuite name="pytest">'
        '<testcase classname="test_x" name="test_hostile" time="0.0">'
        f'<failure message="{first_line}&#10;{secret}"/>'
        "</testcase></testsuite></testsuites>"
    )
    msg = parse_junit(xml)[0]["message"]
    assert msg == "A" * 300  # first line only, capped at 300 chars
    assert len(msg) == 300
    assert secret not in msg
    assert "\n" not in msg


def test_run_tests_platform_error_is_not_converted_to_submission_error(monkeypatch):
    # Task 7's run_sandbox distinguishes a judge/Docker malfunction
    # (platform_error, excluded from ranking) from the player's own fault
    # (submission_error, scores 0 but stays ranked). run_tests must preserve
    # that split, not fold a platform_error into submission_error.
    def fake_run_sandbox(files, cmd, timeout_s=30, keep=()):
        return runner.SandboxResult(-1, False, {}, "sandbox infrastructure failure: boom")

    monkeypatch.setattr(testing, "run_sandbox", fake_run_sandbox)
    results, sub_err, plat_err = run_tests("code", {"test_build.py": "def test_x():\n    assert True\n"})
    assert results == []
    assert sub_err is None
    assert plat_err == "sandbox infrastructure failure: boom"


@pytest.mark.docker
def test_run_tests_end_to_end():
    results, sub_err, plat_err = run_tests(
        "def add(a, b):\n    return a + b\n",
        {"test_build.py": "from solution import add\n"
                          "def test_ok():\n    assert add(1, 2) == 3\n"
                          "def test_bad():\n    assert add(1, 2) == 4\n"})
    assert plat_err is None and sub_err is None
    assert sum(r["passed"] for r in results) == 1 and len(results) == 2


@pytest.mark.docker
def test_run_tests_stdout_never_reaches_results():
    # The product invariant this whole task exists to enforce: raw stdout is
    # NEVER returned to the player. A test that prints (a player trying to
    # exfiltrate hidden-test content via print()) then fails must not have
    # that printed content show up anywhere in the returned rows.
    secret = "SECRET_STDOUT_LEAK_MARKER"
    results, sub_err, plat_err = run_tests(
        "def add(a, b):\n    return a + b\n",
        {"test_build.py": "from solution import add\n"
                          f"def test_bad():\n    print({secret!r})\n    assert add(1, 2) == 4\n"})
    assert plat_err is None and sub_err is None
    assert len(results) == 1 and results[0]["passed"] is False
    assert secret not in str(results)


@pytest.mark.docker
def test_run_tests_infinite_loop_is_submission_fault():
    # R4: the brief's original fixture (a test_x asserting True, never
    # importing solution) never executes `code`'s `while True: pass` at all
    # -- pytest collects and runs it in milliseconds, writes a PASSING
    # result.xml, and this test's assertion (results == [] and sub_err)
    # fails. `import solution` forces the module-level infinite loop to
    # actually run during collection, so the sandboxed pytest process really
    # hangs and the phase really times out (confirmed live: this assertion
    # fails without the import, passes with it -- see task-8-report.md).
    results, sub_err, plat_err = run_tests(
        "while True: pass\n",
        {"test_build.py": "import solution\ndef test_x():\n    assert True\n"})
    assert results == [] and sub_err and plat_err is None
