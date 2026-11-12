"""Judge harness.

Runs unchanged in two places: the visitor's browser (Pyodide worker, see
public/py-worker.js) and locally (verify.py). Input and output are plain JSON.
"""
import contextlib
import io
import json
import time

SLOW_ITERATION_MS = 2000  # one iteration this slow is enough signal; skip the rest


def _load(code):
    namespace = {"__name__": "submission"}
    exec(compile(code, "submission.py", "exec"), namespace)
    return namespace


def _describe(error):
    return f"{type(error).__name__}: {str(error)[:160]}"


def _run_suite(namespace, suite):
    scope = dict(namespace)
    exec(compile(suite["src"], suite["name"] + ".py", "exec"), scope)
    results = []
    # Only the suite's own tests: generated code can define test_* functions too.
    own = [n for n in scope if n.startswith("test_") and callable(scope[n]) and scope[n] is not namespace.get(n)]
    for name in own:
        try:
            scope[name]()
            results.append({"suite": suite["name"], "name": name, "passed": True, "message": ""})
        except BaseException as error:  # generated code may raise anything, SystemExit included
            results.append({"suite": suite["name"], "name": name, "passed": False, "message": _describe(error)})
    return results


def _time_once(bench, namespace):
    data = bench["make_input"]()
    start = time.perf_counter()
    bench["run"](namespace, data)
    return (time.perf_counter() - start) * 1000


def _bench(submission, reference, bench_src):
    """Returns (reference ms, submission ms).

    Best of 5, because timing noise only ever adds time. The two are timed in
    turns so both see the same machine state (warm-up, throttling, GC).
    """
    bench = {}
    exec(compile(bench_src, "bench.py", "exec"), bench)
    ref_ms, sub_ms = [], []
    for _ in range(5):
        ref_ms.append(_time_once(bench, reference))
        sub_ms.append(_time_once(bench, submission))
        if sub_ms[-1] > SLOW_ITERATION_MS:
            break
    return min(ref_ms), min(sub_ms)


def run(payload):
    result = {
        "load_error": None,
        "tests": [],
        "sub_ms": None,
        "ref_ms": None,
        "bench_error": None,
    }
    sink = io.StringIO()  # generated code's prints never reach the player
    with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        try:
            namespace = _load(payload["code"])
        except BaseException as error:
            namespace = {}
            result["load_error"] = _describe(error)
        for suite in payload["suites"]:
            result["tests"] += _run_suite(namespace, suite)
        if any(test["passed"] for test in result["tests"]):
            try:
                result["ref_ms"], result["sub_ms"] = _bench(
                    namespace, _load(payload["reference"]), payload["bench"]
                )
            except BaseException as error:
                result["bench_error"] = _describe(error)
    return result


def run_json(payload_json):
    return json.dumps(run(json.loads(payload_json)))
