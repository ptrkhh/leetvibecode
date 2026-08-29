import logging
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

logger = logging.getLogger(__name__)


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
        prior_code = rows[0]["generatedCode"] or "# no code block was produced in round 0"
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
    # ponytail: this INSERT is not guarded against running twice for the same
    # run_id, which the R86 sweep makes theoretically reachable (process dies
    # between this line and work_one's finish_job -- the "generate" Job gets
    # requeued and handle_generate runs again, inserting a second "test" Job
    # for the same run). Harmless rather than corrupting: handle_test's own
    # writes are idempotent (delete-then-insert, above), so a duplicated test
    # Job just re-runs the sandbox and the later write wins -- wasted compute,
    # not wrong data. Close it properly with `WHERE NOT EXISTS (SELECT 1 FROM
    # "Job" WHERE "runId"=%s AND type='test')` if that compute ever matters.
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
    # R86: this handler can now be re-run from scratch by the stale-claim
    # sweep below. Every db.q() commits on its own (no transaction spans the
    # handler), so a process that died partway through the INSERT loops here
    # may have already left SOME rows committed -- without clearing first, a
    # retry would insert a second, overlapping set on top instead of
    # replacing it. Both tables, unconditionally, so a retry that goes down
    # a different branch (e.g. passed==0 this time) can't leave a stale
    # BenchmarkResult set behind either.
    db.q('DELETE FROM "TestResult" WHERE "runId"=%s', (run_id,))
    db.q('DELETE FROM "BenchmarkResult" WHERE "runId"=%s', (run_id,))
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
    # R42: work_one's own except block (_fail, db.finish_job) is unprotected --
    # if the same DB blip that fails a handler also fails recording that
    # failure, the exception used to propagate out of work_one and kill this
    # daemon thread forever (nothing restarts a dead daemon thread), leaving
    # its Run non-terminal and its Job stuck "claimed". That used to be
    # permanent (no stale-claim reclaim existed anywhere in the judge); R86's
    # sweep below now recovers it eventually, but a thread dying here still
    # permanently shrinks the worker pool by one, so this guard still earns
    # its keep. One iteration must never be able to end the loop. Reuse the
    # existing empty-queue sleep as the pacing for a failed iteration too,
    # rather than inventing separate backoff.
    while True:
        try:
            if not work_one(job_type):
                time.sleep(1)
        except Exception:
            logger.exception("worker loop iteration failed (job_type=%s)", job_type)
            time.sleep(1)


# R86: worst-case LEGITIMATE duration a Job may sit "claimed" while its
# worker is genuinely still working it, not a round number -- too short and
# the sweep requeues a job that is only slow, so a second worker claims the
# same run while the first is still on it (double execution; for "generate"
# that spends OpenRouter tokens twice).
#
#   generate (openrouter.py generate()): 3 attempts, each bounded by the
#   client's own configured timeout (`httpx.Client(timeout=120)`), with
#   backoff of 2s then 4s between the first two failures and none after the
#   last (R17c: "no sleep after the final failed attempt"). Worst legitimate
#   total: 3*120 + 2 + 4 = 366s.
#
#   test (handle_test): run_tests, then -- only if at least one test passed
#   -- run_bench. Each is one run_sandbox call with timeout_s=30, whose own
#   container.wait() is given timeout_s+5=35s before it kills the container
#   (runner.py). Worst legitimate total: 2*35 = 70s.
#
# generate is the binding case at 366s. 600s clears it by ~1.6x -- margin
# for scheduler jitter and the handful of small DB round trips around the
# API call, while still bounding recovery of a truly dead job to ten
# minutes. Override via env if the retry count or either timeout above ever
# changes.
STALE_CLAIM_TIMEOUT_S = int(os.environ.get("STALE_CLAIM_TIMEOUT_S", 600))
# How often the sweep runs -- independent of the timeout above, since this
# only controls how promptly a stale claim is noticed, not what counts as
# stale. One UPDATE query per tick; cheap enough to run every minute without
# the interval itself needing to be measured.
SWEEP_INTERVAL_S = int(os.environ.get("SWEEP_INTERVAL_S", 60))


def _sweep_loop() -> None:
    # Same shape as _loop, and for the same reason (R42): one bad iteration
    # (a DB blip) must not kill this thread, since nothing restarts a dead
    # daemon thread and this loop is now the only thing that ever recovers a
    # job orphaned by a judge process that died mid-handler.
    while True:
        try:
            reclaimed = db.requeue_stale_claims(STALE_CLAIM_TIMEOUT_S)
            if reclaimed:
                logger.warning("requeued %d stale claimed job(s): %s", len(reclaimed), reclaimed)
        except Exception:
            logger.exception("stale-claim sweep iteration failed")
        time.sleep(SWEEP_INTERVAL_S)


def start_workers() -> None:
    for _ in range(int(os.environ.get("GEN_THREADS", 4))):
        threading.Thread(target=_loop, args=("generate",), daemon=True).start()
    for _ in range(int(os.environ.get("TEST_THREADS", 2))):
        threading.Thread(target=_loop, args=("test",), daemon=True).start()
    threading.Thread(target=_sweep_loop, daemon=True).start()


# ponytail: global thread caps stand in for per-model concurrency limits; add a per-model semaphore in _loop when one model saturates the pool.
