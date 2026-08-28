import os
import pathlib
import threading
import time
import uuid

import db
from benching import run_bench
from extract import extract_code
from openrouter import PlatformError, build_messages, generate
from testing import run_tests


def _load_run(run_id: str) -> dict:
    return db.q('''
        SELECT r.id, r."generatedCode", rnd.index AS round_index, rnd."promptText",
               rnd."attemptId", m."openrouterId",
               c.slug, c."interfaceText", c."followupPrompt"
        FROM "Run" r
        JOIN "Round" rnd ON rnd.id = r."roundId"
        JOIN "Attempt" a ON a.id = rnd."attemptId"
        JOIN "Challenge" c ON c.id = a."challengeId"
        JOIN "Model" m ON m.id = r."modelId"
        WHERE r.id = %s''', (run_id,))[0]


def _fail(run_id: str, kind: str, message: str) -> None:
    db.q('UPDATE "Run" SET status=%s, "errorKind"=%s, "errorMessage"=%s WHERE id=%s',
         ("error", kind, message[:500], run_id))


def _challenge_dir(slug: str) -> pathlib.Path:
    return pathlib.Path(os.environ["CHALLENGES_DIR"]) / slug


def handle_generate(run_id: str) -> None:
    ctx = _load_run(run_id)
    db.q('UPDATE "Run" SET status=%s WHERE id=%s', ("generating", run_id))
    prior_code = None
    if ctx["round_index"] == 1:
        rows = db.q('''
            SELECT r."generatedCode", rnd."promptText" FROM "Run" r
            JOIN "Round" rnd ON rnd.id = r."roundId"
            WHERE rnd."attemptId" = %s AND rnd.index = 0
              AND r."modelId" = (SELECT "modelId" FROM "Run" WHERE id = %s)''',
            (ctx["attemptId"], run_id))
        # submission-fault round-0 runs proceed with an empty-code conversation
        prior_code = rows[0]["generatedCode"] or "# no code block was produced in round 1"
        round0_prompt = rows[0]["promptText"]
    else:
        round0_prompt = ctx["promptText"]
    msgs = build_messages(ctx["interfaceText"], round0_prompt, ctx["round_index"],
                          prior_code, ctx["followupPrompt"])
    try:
        text, pt, ct = generate(ctx["openrouterId"], msgs, ctx["slug"])
    except PlatformError as e:
        _fail(run_id, "platform", str(e))
        return
    db.q('UPDATE "Run" SET "promptTokens"=%s, "completionTokens"=%s WHERE id=%s', (pt, ct, run_id))
    code = extract_code(text)
    if code is None:
        _fail(run_id, "submission",
              "no code block in model response — try specifying the output format")
        return
    db.q('UPDATE "Run" SET "generatedCode"=%s, status=%s WHERE id=%s', (code, "testing", run_id))
    db.q('INSERT INTO "Job"(id, "runId", type) VALUES (%s, %s, %s)',
         (str(uuid.uuid4()), run_id, "test"))


def handle_test(run_id: str) -> None:
    ctx = _load_run(run_id)
    cdir = _challenge_dir(ctx["slug"])
    suites = {"test_build.py": (cdir / "tests" / "test_build.py").read_text()}
    if ctx["round_index"] == 1:
        suites["test_extend.py"] = (cdir / "tests" / "test_extend.py").read_text()
    results, sub_err, plat_err = run_tests(ctx["generatedCode"], suites)
    if plat_err:
        _fail(run_id, "platform", plat_err)
        return
    for t in results:
        db.q('INSERT INTO "TestResult"(id, "runId", name, passed, message, "runtimeMs") '
             "VALUES (%s, %s, %s, %s, %s, %s)",
             (str(uuid.uuid4()), run_id, t["name"], t["passed"], t["message"], t["runtimeMs"]))
    passed = sum(t["passed"] for t in results)
    if passed > 0:  # accuracy 0 already zeroes the score; skip a pointless 30s bench
        bench_py = (cdir / "benchmarks" / "bench.py").read_text()
        rows, bench_err, plat_err = run_bench(ctx["generatedCode"], bench_py)
        if plat_err:
            _fail(run_id, "platform", plat_err)
            return
        for b in rows:
            db.q('INSERT INTO "BenchmarkResult"(id, "runId", "inputSize", "timeMs", "memoryMb", '
                 '"timedOut") VALUES (%s, %s, %s, %s, %s, %s)',
                 (str(uuid.uuid4()), run_id, b["inputSize"], b["timeMs"], b["memoryMb"], b["timedOut"]))
        sub_err = sub_err or bench_err
    db.q('UPDATE "Run" SET status=%s, "errorMessage"=%s WHERE id=%s', ("done", sub_err, run_id))


HANDLERS = {"generate": handle_generate, "test": handle_test}


def work_one(job_type: str) -> bool:
    job = db.claim_job(job_type, f"{job_type}-{threading.get_ident()}")
    if job is None:
        return False
    try:
        HANDLERS[job_type](job["runId"])
        db.finish_job(job["id"])
    except Exception as e:  # judge malfunction = platform fault, never a stuck job
        _fail(job["runId"], "platform", f"judge malfunction: {e}")
        db.finish_job(job["id"], error=str(e))
    return True


def _loop(job_type: str) -> None:
    while True:
        if not work_one(job_type):
            time.sleep(1)


def start_workers() -> None:
    for _ in range(int(os.environ.get("GEN_THREADS", 4))):
        threading.Thread(target=_loop, args=("generate",), daemon=True).start()
    for _ in range(int(os.environ.get("TEST_THREADS", 2))):
        threading.Thread(target=_loop, args=("test",), daemon=True).start()


# ponytail: global thread caps stand in for per-model concurrency limits; add a per-model semaphore in _loop when one model saturates the pool.
