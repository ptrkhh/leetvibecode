import pytest
from runner import run_sandbox

pytestmark = pytest.mark.docker


def test_runs_code_and_returns_written_files():
    r = run_sandbox({"main.py": "open('/work/out.txt','w').write('hi')"},
                    ["python", "main.py"])
    assert r.exit_code == 0 and r.files["out.txt"] == "hi" and not r.timed_out


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


def test_infinite_loop_times_out():
    r = run_sandbox({"main.py": "while True: pass"}, ["python", "main.py"], timeout_s=3)
    assert r.timed_out


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
    # pids limit actually rejected a fork call -- not a wall-clock kill papering over an unbounded loop:
    assert not r.timed_out and "blocked.txt" in r.files
