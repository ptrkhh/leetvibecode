import os
import pathlib

import docker
import pytest
import requests
import urllib3.exceptions

import runner
from runner import run_sandbox

# R30: _is_wait_timeout is pure and needs no daemon, so its tests (and the
# platform_error path they exercise) deliberately sit OUTSIDE the `docker`
# marker below -- this is exactly why R26's over-broad match survived a
# careful manual experiment last round: nothing pinned the four cases down
# as a regression test.


def _chain(outer: BaseException, inner: BaseException) -> BaseException:
    """Raise `inner` then `outer` from inside its except block, so `outer`
    picks up Python's implicit exception chaining (__context__) exactly the
    way requests' real adapters do when they wrap a lower-level error -- the
    same mechanism confirmed live against the real daemon."""
    try:
        raise inner
    except type(inner):
        try:
            raise outer
        except type(outer) as exc:
            return exc


def test_is_wait_timeout_true_for_real_read_timeout():
    # matches the confirmed live shape: requests.exceptions.ConnectionError
    # wrapping a urllib3 ReadTimeoutError -- NOT requests.exceptions.ReadTimeout,
    # despite docker-py's own docstring implying that type.
    inner = urllib3.exceptions.ReadTimeoutError(None, "/wait", "Read timed out.")
    exc = _chain(requests.exceptions.ConnectionError(inner), inner)
    assert runner._is_wait_timeout(exc) is True


def test_is_wait_timeout_false_for_daemon_died_mid_wait():
    # matches the confirmed live shape from SIGKILL-ing dockerd mid-wait:
    # requests.exceptions.ChunkedEncodingError wrapping a urllib3 ProtocolError.
    inner = urllib3.exceptions.ProtocolError("Response ended prematurely")
    exc = _chain(requests.exceptions.ChunkedEncodingError(inner), inner)
    assert runner._is_wait_timeout(exc) is False


def test_is_wait_timeout_false_for_connection_refused():
    # R26: matches the shape confirmed live against tcp://127.0.0.1:1 (nothing
    # listening): ConnectionError -> MaxRetryError -> NewConnectionError ->
    # ConnectionRefusedError. NewConnectionError IS a urllib3 TimeoutError
    # subclass -- the too-broad match this test guards against regressing to.
    inner = urllib3.exceptions.NewConnectionError(None, "Connection refused")
    exc = _chain(requests.exceptions.ConnectionError(inner), inner)
    assert runner._is_wait_timeout(exc) is False


def test_is_wait_timeout_false_for_docker_api_error():
    assert runner._is_wait_timeout(docker.errors.NotFound("no such container")) is False


# R25/R29: _safe_read is likewise pure (plain filesystem calls) -- no daemon needed.

def test_safe_read_skips_symlink(tmp_path):
    target = tmp_path / "target.txt"
    target.write_text("secret-host-content")
    link = tmp_path / "link.txt"
    link.symlink_to(target)
    assert runner._safe_read(link) is None


def test_safe_read_skips_oversized_file(tmp_path):
    big = tmp_path / "big.txt"
    big.write_text("x" * (runner.MAX_OUTPUT_BYTES + 1))
    assert runner._safe_read(big) is None
    small = tmp_path / "small.txt"
    small.write_text("ok")
    assert runner._safe_read(small) == "ok"  # cap doesn't clip a normal-sized file


def test_safe_read_tolerates_read_failure(tmp_path, monkeypatch):
    # a payload chmod'ing its own result file to deny read access must not
    # crash the whole run into platform_error -- the file is just omitted
    # (missing key -> submission fault downstream), the player's own problem.
    p = tmp_path / "unreadable.txt"
    p.write_text("data")

    def boom(self, *a, **kw):
        raise PermissionError("denied")

    monkeypatch.setattr(pathlib.Path, "read_text", boom)
    assert runner._safe_read(p) is None


# --- integration tests against the real daemon + lvc-sandbox image ---


@pytest.mark.docker
def test_runs_code_and_returns_written_files():
    r = run_sandbox({"main.py": "open('/work/out.txt','w').write('hi')"},
                    ["python", "main.py"])
    assert r.exit_code == 0 and r.files["out.txt"] == "hi" and not r.timed_out


@pytest.mark.docker
def test_no_network():
    # R24: `exit_code != 0` alone proves nothing -- a broken image or a
    # typo'd command "passes" the same way without ever testing containment.
    # The payload writes a marker BEFORE attempting the network call (proof
    # the sandbox genuinely executed it), then writes a SECOND marker only on
    # the path that means containment FAILED (the request succeeding).
    # Containment holds iff that second marker is absent AND we have positive
    # evidence the call was actually attempted and rejected (not skipped, not
    # crashed before it got there).
    code = (
        "import pathlib, urllib.request\n"
        "pathlib.Path('/work/started.txt').write_text('started')\n"
        "try:\n"
        "    urllib.request.urlopen('http://example.com', timeout=3)\n"
        "    pathlib.Path('/work/leaked.txt').write_text('NETWORK_REACHABLE')\n"
        "except Exception as e:\n"
        "    pathlib.Path('/work/blocked.txt').write_text(str(e))\n"
    )
    r = run_sandbox({"main.py": code}, ["python", "main.py"])
    assert "started.txt" in r.files  # sandbox genuinely ran our code
    assert "leaked.txt" not in r.files  # containment-FAILED marker must be absent
    # request was attempted and rejected -- not skipped, not a crash:
    assert not r.timed_out and r.exit_code == 0 and "blocked.txt" in r.files


@pytest.mark.docker
def test_infinite_loop_times_out():
    r = run_sandbox({"main.py": "while True: pass"}, ["python", "main.py"], timeout_s=3)
    assert r.timed_out


@pytest.mark.docker
def test_fork_bomb_contained():
    # R24: same gap as test_no_network -- "exit_code != 0 or timed_out" is
    # satisfied by a broken image too. This payload marks a BOUNDED fork loop
    # (each child exits immediately instead of forking further, so process
    # growth is linear, not a literal fork bomb's 2^n explosion -- still a
    # faithful test of "is unbounded process creation stopped", without the
    # blast-radius risk of a real exponential bomb on a shared host if
    # pids_limit turned out not to be wired up). "unbounded.txt" existing is
    # the containment-FAILED marker (all 100000 forks succeeded); "blocked.txt"
    # is positive evidence os.fork() itself was rejected by the kernel once
    # the container hit its pids ceiling.
    code = (
        "import os, pathlib\n"
        "pathlib.Path('/work/started.txt').write_text('started')\n"
        "count = 0\n"
        "try:\n"
        "    for _ in range(100000):\n"
        "        pid = os.fork()\n"
        "        if pid == 0:\n"
        "            os._exit(0)\n"
        "        count += 1\n"
        "    pathlib.Path('/work/unbounded.txt').write_text(str(count))\n"
        "except OSError as e:\n"
        "    pathlib.Path('/work/blocked.txt').write_text(f'{count}:{e.errno}:{e.strerror}')\n"
    )
    r = run_sandbox({"main.py": code}, ["python", "main.py"], timeout_s=5)
    assert "started.txt" in r.files  # sandbox genuinely ran our code
    assert "unbounded.txt" not in r.files  # containment-FAILED marker must be absent
    assert not r.timed_out and "blocked.txt" in r.files
    # errno specifically 11 (EAGAIN) -- proves the *pids* limit rejected the
    # fork, not e.g. ENOMEM from some other resource giving out first:
    _, errno_str, _ = r.files["blocked.txt"].split(":", 2)
    assert errno_str == "11"


@pytest.mark.docker
def test_symlink_target_content_not_leaked():
    # R25/R30: a payload that plants a symlink under /work to a host path
    # must never have that target's content show up in r.files -- is_file()
    # follows symlinks and the read happens with the JUDGE's privileges, so
    # this is the spec's "read the hidden tests / phone home" threat with no
    # network involved. Plant a secret file under SANDBOX_DIR (host-visible,
    # outside this run's own box) and have the payload symlink to it under
    # the exact key testing.py reads (result.xml).
    secret = "TOP-SECRET-HOST-ONLY-CONTENT-r25"
    secret_path = pathlib.Path(os.environ.get("SANDBOX_DIR", "/tmp/lvc-sandbox")) / "r25-secret.txt"
    secret_path.write_text(secret)
    try:
        code = f"import os\nos.symlink({str(secret_path)!r}, '/work/result.xml')\n"
        r = run_sandbox({"main.py": code}, ["python", "main.py"])
        assert r.exit_code == 0  # sandbox genuinely ran the symlink() call, not "never ran"
        assert secret not in r.files.get("result.xml", "")
        assert all(secret not in v for v in r.files.values())
    finally:
        secret_path.unlink(missing_ok=True)
