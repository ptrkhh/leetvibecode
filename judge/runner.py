import os
import pathlib
import shutil
import uuid
from collections import namedtuple

import docker
import urllib3.exceptions

SandboxResult = namedtuple("SandboxResult", "exit_code timed_out files platform_error")
IMAGE = "lvc-sandbox"

# ponytail: no pre-warmed container pool -- docker run with a cached image is
# ~300ms against a 30s phase budget; add a pool when p95 latency measurably hurts.

_docker_client = None


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


def _is_wait_timeout(exc: BaseException) -> bool:
    """True only for container.wait()'s own client-side read timeout -- the
    one failure that legitimately means "the player's code ran too long".

    R6: confirmed by experiment, not assumed.
    container.wait(timeout=N) on a still-running container raises
    requests.exceptions.ConnectionError whose __context__/args[0] is a
    urllib3.exceptions.ReadTimeoutError -- NOT requests.exceptions.ReadTimeout
    (what a standard requests HTTPAdapter would raise; docker-py's unix-socket
    transport wraps it differently). A genuine daemon failure mid-wait
    (reproduced by SIGKILL-ing dockerd while a wait() call was in flight)
    instead raises requests.exceptions.ChunkedEncodingError wrapping a
    urllib3 ProtocolError -- no TimeoutError anywhere in its chain. Both share
    the same top-level base (requests.exceptions.RequestException), so the
    discriminator has to walk the chain for a urllib3 TimeoutError, not just
    check the outer exception's class -- that would conflate them right back
    together, reproducing the exact bug this function exists to avoid.
    """
    seen = set()
    cur = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        if isinstance(cur, urllib3.exceptions.TimeoutError):
            return True
        nxt = cur.__cause__ or cur.__context__
        if nxt is None:
            nxt = next((a for a in getattr(cur, "args", ()) if isinstance(a, BaseException)), None)
        cur = nxt
    return False


def run_sandbox(files: dict[str, str], cmd: list[str], timeout_s: int = 30) -> SandboxResult:
    box = uuid.uuid4().hex
    workdir = pathlib.Path(os.environ.get("SANDBOX_DIR", "/tmp/lvc-sandbox")) / box
    hostdir = pathlib.Path(os.environ.get("SANDBOX_HOST_DIR", str(workdir.parent))) / box
    workdir.mkdir(parents=True)
    os.chmod(workdir, 0o777)  # sandbox user 'runner' must write results
    for name, content in files.items():
        (workdir / name).write_text(content)
    container = None
    try:
        container = _client().containers.run(
            IMAGE, cmd, detach=True, network_disabled=True,
            mem_limit="512m", pids_limit=128, nano_cpus=1_000_000_000,
            read_only=True, tmpfs={"/tmp": "size=16m"},
            volumes={str(hostdir): {"bind": "/work", "mode": "rw"}},
            working_dir="/work", user="runner",
        )
        try:
            exit_code = container.wait(timeout=timeout_s + 5)["StatusCode"]
            timed_out = False
        except Exception as e:
            if not _is_wait_timeout(e):
                raise  # judge malfunction, not a submission fault -- outer handler reports it
            container.kill()
            exit_code, timed_out = -1, True
        out = {p.name: p.read_text(errors="replace")
               for p in workdir.iterdir() if p.is_file() and p.name not in files}
        return SandboxResult(exit_code, timed_out, out, None)
    except Exception as e:
        # R6: anything landing here -- containers.run() itself failing, a
        # non-timeout wait() failure re-raised above, cleanup races below --
        # is a judge-side fault, never the player's. Always platform_error.
        return SandboxResult(-1, False, {}, f"sandbox infrastructure failure: {e}")
    finally:
        if container is not None:
            try:
                container.remove(force=True)
            except Exception:
                pass
        shutil.rmtree(workdir, ignore_errors=True)
