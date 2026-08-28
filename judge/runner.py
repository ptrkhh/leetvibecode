import logging
import os
import pathlib
import shutil
import threading
import uuid
from collections import namedtuple

import docker
import requests
import urllib3.exceptions

SandboxResult = namedtuple("SandboxResult", "exit_code timed_out files platform_error")
IMAGE = "lvc-sandbox"
# R29: /work is a bind mount on the unquota'd host root -- mem_limit does not
# bound writes to it (30 MiB written in 0.4s, all read straight back). Neither
# result.xml nor bench.json needs more than a few hundred KB; 1 MiB/file is a
# generous cap that still hard-stops an unbounded write from reaching judge memory.
MAX_OUTPUT_BYTES = 1_048_576
# R32: the per-file cap alone doesn't bound the FILE COUNT -- 200 files just
# under MAX_OUTPUT_BYTES measured 200 MB into judge memory in 1.4s. result.xml
# and bench.json are the only outputs that matter and neither is large; 4 MiB
# (4x the per-file cap) comfortably covers a few real files plus incidental
# stray writes while making a many-small-files run impossible.
MAX_TOTAL_OUTPUT_BYTES = 4_194_304

logger = logging.getLogger(__name__)

# ponytail: no pre-warmed container pool -- docker run with a cached image is
# ~300ms against a 30s phase budget; add a pool when p95 latency measurably hurts.

_docker_client = None
_mount_checked = False
_mount_error = None
_mount_lock = threading.Lock()


def _client():
    # R5: created lazily so *importing* this module never touches Docker.
    # testing.py/benching.py/worker.py/app.py all import run_sandbox
    # transitively; a module-scope docker.from_env() would make every one of
    # them fail to import wherever no daemon is reachable -- including unit
    # tests that never touch Docker -- and it defeats the point of the
    # skippable `docker` pytest marker.
    global _docker_client
    if _docker_client is None:
        _docker_client = docker.from_env()
    return _docker_client


def _new_sandbox_dir() -> tuple[pathlib.Path, pathlib.Path]:
    box = uuid.uuid4().hex
    workdir = pathlib.Path(os.environ.get("SANDBOX_DIR", "/tmp/lvc-sandbox")) / box
    hostdir = pathlib.Path(os.environ.get("SANDBOX_HOST_DIR", str(workdir.parent))) / box
    workdir.mkdir(parents=True)
    os.chmod(workdir, 0o777)  # sandbox user 'runner' must write results
    return workdir, hostdir


def _run_mount_canary():
    workdir, hostdir = _new_sandbox_dir()
    marker = uuid.uuid4().hex
    (workdir / "canary.txt").write_text(marker)
    container = None
    try:
        container = _client().containers.create(
            IMAGE, ["cat", "/work/canary.txt"], network_disabled=True,
            mem_limit="64m", pids_limit=16, nano_cpus=1_000_000_000,
            read_only=True, tmpfs={"/tmp": "size=4m"},
            volumes={str(hostdir): {"bind": "/work", "mode": "ro"}},
            working_dir="/work", user="runner",
        )
        container.start()
        exit_code = container.wait(timeout=10)["StatusCode"]
        seen = container.logs(stdout=True, stderr=False).decode(errors="replace").strip()
        if exit_code != 0 or seen != marker:
            raise RuntimeError(
                f"SANDBOX_DIR/SANDBOX_HOST_DIR mount mismatch -- judge wrote a "
                f"marker under {workdir}, container saw {seen!r} (exit {exit_code})"
            )
    finally:
        if container is not None:
            try:
                container.remove(force=True)
            except Exception as e:
                logger.warning("mount-canary container cleanup failed: %s", e)
        shutil.rmtree(workdir, ignore_errors=True)


def _verify_mount():
    """R28: once per process, confirm a file the judge writes under
    SANDBOX_DIR is actually visible in a container's /work -- i.e. that
    SANDBOX_HOST_DIR really names the same directory from the daemon's side.
    Get this wrong (e.g. a misconfigured SANDBOX_HOST_DIR) and Docker just
    silently auto-creates an empty directory at the bind-mount source: every
    submission's own /work is empty, every payload fails to find its input
    files, and every run gets scored as broken code -- while the judge is
    what's actually misconfigured. The real check runs at most once per
    process; a cached failure is re-raised on every later call without
    spawning another container.

    R31: check-then-act on the two globals above, unguarded, let a "winning"
    thread flip _mount_checked to True BEFORE its (slow) canary finished --
    every other concurrent caller then saw "checked=True, error=None" and
    sailed through an unverified mount, reintroducing R28's exact defect in
    a timing-dependent form. Not reachable while nothing calls run_sandbox
    concurrently, but Task 10 adds worker threads that do. The lock below
    holds for the ENTIRE check-run-raise sequence, so every thread either
    does the one real canary run, or blocks until it's fully finished (pass
    or fail) before it can even read the result -- there is no window where
    a thread observes "checked" without also seeing the matching error.
    """
    global _mount_checked, _mount_error
    with _mount_lock:
        if not _mount_checked:
            try:
                _run_mount_canary()
            except Exception as e:
                _mount_error = e
            _mount_checked = True
        if _mount_error is not None:
            raise _mount_error


def _is_wait_timeout(exc: BaseException) -> bool:
    """True only for container.wait()'s own client-side read timeout -- the
    one failure that legitimately means "the player's code ran too long".
    Every other docker-py/requests/urllib3 failure must return False so it
    surfaces as platform_error instead (R6).

    Confirmed by experiment against a real daemon, not assumed:
    - genuine wait expiry -> requests.exceptions.ConnectionError wrapping a
      urllib3.exceptions.ReadTimeoutError (NOT requests.exceptions.ReadTimeout,
      despite docker-py's own docstring implying that type).
    - daemon killed mid-wait -> requests.exceptions.ChunkedEncodingError
      wrapping a urllib3 ProtocolError.
    - daemon refuses the connection (DOCKER_HOST=tcp:// unreachable) ->
      requests.exceptions.ConnectionError wrapping urllib3's MaxRetryError ->
      NewConnectionError -> ConnectionRefusedError.

    R26: matching urllib3's TimeoutError BASE class (an earlier version of
    this function did) is too broad -- NewConnectionError/ConnectTimeoutError
    are TimeoutError subclasses too, so the third case above would be
    misclassified as a player timeout, the exact inversion this function
    exists to prevent. ReadTimeoutError is a sibling of those two under
    TimeoutError, not their ancestor, so matching it specifically (plus
    requests' own ReadTimeout, for a future docker-py/requests pairing that
    raises the "textbook" type directly) correctly excludes them.
    """
    seen = set()
    cur = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        if isinstance(cur, (urllib3.exceptions.ReadTimeoutError, requests.exceptions.ReadTimeout)):
            return True
        nxt = cur.__cause__ or cur.__context__
        if nxt is None:
            nxt = next((a for a in getattr(cur, "args", ()) if isinstance(a, BaseException)), None)
        cur = nxt
    return False


def _safe_read(p: pathlib.Path) -> str | None:
    """R25: is_file()/stat() below FOLLOW symlinks, and this read runs with
    the judge's own privileges -- a payload planting a symlink under /work to
    a host path (proven live: a planted symlink returned an arbitrary host
    file's content under the result.xml key) must never be followed.
    is_symlink() never itself follows, and is checked before anything that
    would.

    Also (R29) never load an unbounded write into judge memory, and (R25)
    never let one unreadable output file (e.g. self-chmod'd 0600) abort the
    whole run into platform_error -- a missing file is already a clean,
    correctly-handled submission fault downstream (Task 8/9 both treat a
    missing key as "no result produced"), which is the right bucket for a
    player's own self-inflicted damage, not a judge malfunction.
    """
    if p.is_symlink() or not p.is_file():
        return None
    try:
        if p.stat().st_size > MAX_OUTPUT_BYTES:
            return None
        return p.read_text(errors="replace")
    except OSError:
        return None


def _collect_outputs(workdir: pathlib.Path, input_files: dict[str, str],
                      keep: tuple[str, ...] = ()) -> dict[str, str]:
    """Everything under workdir except the caller's own inputs, subject to
    _safe_read's per-file rules (R25/R29) AND a combined per-run cap (R32).

    R33: workdir.iterdir()'s order is unspecified -- measured live on this
    host's real ext4 to be neither alphabetical nor creation-order (a file
    created LAST came back 2nd of 22). Stopping the combined cap at raw
    iterdir() order let a handful of incidental junk files crowd out
    result.xml/bench.json before the cap ever reached them, turning "the
    judge exhausted its own budget" into "the judge manufactured a
    submission fault out of nothing" -- exactly the player penalty the
    platform/submission split forbids, and only because round 2 added the
    cap. Fixed two ways: `keep` names the files the caller actually needs
    (Task 8/9/11 declare result.xml/bench.json) -- those are read first and
    are exempt from the combined cap (still bounded by _safe_read's
    per-file cap, which is what actually bounds them); everything else
    fills the remaining combined budget afterwards in deterministic SORTED
    order, so a truncation is at least reproducible instead of
    filesystem-dependent. Also: the running total is now p.stat().st_size
    (real bytes) rather than len(content) (characters) -- multi-byte UTF-8
    let up to ~4x the advertised MAX_TOTAL_OUTPUT_BYTES through.
    """
    names = sorted(p.name for p in workdir.iterdir() if p.name not in input_files)
    ordered = [n for n in keep if n in names] + [n for n in names if n not in keep]

    out = {}
    total = 0
    for name in ordered:
        p = workdir / name
        content = _safe_read(p)
        if content is None:
            continue
        if name in keep:
            out[name] = content
            continue
        size = p.stat().st_size
        if total + size > MAX_TOTAL_OUTPUT_BYTES:
            break
        out[name] = content
        total += size
    return out


def run_sandbox(files: dict[str, str], cmd: list[str], timeout_s: int = 30,
                 keep: tuple[str, ...] = ()) -> SandboxResult:
    workdir = None
    container = None
    try:
        _verify_mount()
        workdir, hostdir = _new_sandbox_dir()
        for name, content in files.items():
            if not name or "/" in name or "\\" in name or name in (".", ".."):
                raise ValueError(f"unsafe sandbox file name: {name!r}")
            (workdir / name).write_text(content)
        # R27: create() then start(), not run() -- run() itself does exactly
        # this internally, but as two separate calls with `container` bound
        # to the create()'d object before start() is attempted. A start-time
        # failure with run() propagates before `container` is ever assigned,
        # so the finally-cleanup below never runs and the container (created
        # daemon-side even though it never started) leaks forever.
        container = _client().containers.create(
            IMAGE, cmd, detach=True, network_disabled=True,
            mem_limit="512m", pids_limit=128, nano_cpus=1_000_000_000,
            read_only=True, tmpfs={"/tmp": "size=16m"},
            # ponytail: R32's write side -- a bind mount takes no size option,
            # so mem_limit does not stop a payload filling host disk (measured:
            # 100 MiB in 1.27s). Workdirs are rmtree'd after every run, so this
            # is a transient DoS window, not permanent damage; real fix is
            # operational -- a dedicated filesystem or a quota on
            # SANDBOX_HOST_DIR -- add one if a deploy needs it.
            volumes={str(hostdir): {"bind": "/work", "mode": "rw"}},
            working_dir="/work", user="runner",
        )
        container.start()
        try:
            exit_code = container.wait(timeout=timeout_s + 5)["StatusCode"]
            timed_out = False
        except Exception as e:
            if not _is_wait_timeout(e):
                raise  # judge malfunction, not a submission fault -- outer handler reports it
            try:
                container.kill()
            except Exception:
                pass  # already exited on its own between the timeout firing and this call
            exit_code, timed_out = -1, True
        out = _collect_outputs(workdir, files, keep)
        return SandboxResult(exit_code, timed_out, out, None)
    except Exception as e:
        # R6: anything landing here -- the mount canary, containers.create()
        # or start() failing, a non-timeout wait() failure re-raised above,
        # cleanup races below -- is a judge-side fault, never the player's.
        # Always platform_error.
        return SandboxResult(-1, False, {}, f"sandbox infrastructure failure: {e}")
    finally:
        if container is not None:
            try:
                container.remove(force=True)
            except Exception as e:
                logger.warning("sandbox container cleanup failed: %s", e)
        if workdir is not None:
            shutil.rmtree(workdir, ignore_errors=True)
