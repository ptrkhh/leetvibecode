import pathlib
import threading
import time
import uuid

import pytest

import db
import worker

pytestmark = pytest.mark.docker


@pytest.fixture()
def fixture_challenge(tmp_path, monkeypatch):
    # unique slug per run: Challenge.slug is @unique, and this dev DB persists
    # across test invocations (unlike a fresh-per-run DB) -- a literal "adder"
    # collides with the previous run's row. Mirrors test_db.py's own
    # randomized-id-as-slug isolation, applied here via the directory name
    # too since Challenge.slug must match the on-disk challenge dir.
    slug = f"adder-{uuid.uuid4().hex[:8]}"
    ch = tmp_path / slug
    (ch / "reference").mkdir(parents=True)
    (ch / "tests").mkdir()
    (ch / "benchmarks").mkdir()
    (ch / "reference" / "solution.py").write_text("def add(a, b):\n    return a + b\n")
    (ch / "tests" / "test_build.py").write_text(
        "from solution import add\ndef test_add():\n    assert add(1, 2) == 3\n")
    (ch / "tests" / "test_extend.py").write_text(
        "from solution import add\ndef test_neg():\n    assert add(-1, 1) == 0\n")
    (ch / "benchmarks" / "bench.py").write_text(
        "import solution\nSIZES=[100]\n"
        "def setup(s):\n    return list(range(s))\n"
        "def run(d):\n    [solution.add(x, 1) for x in d]\n")
    monkeypatch.setenv("CHALLENGES_DIR", str(tmp_path))
    monkeypatch.setenv("OPENROUTER_MOCK", "1")
    return slug


def seed_run(slug):
    ids = {k: str(uuid.uuid4()) for k in "user ch att rnd mdl run job".split()}
    db.q('INSERT INTO "User"(id,email,name,"passwordHash") VALUES (%s,%s,%s,%s)',
         (ids["user"], f'{ids["user"]}@t.io', "t", "x"))
    db.q('INSERT INTO "Challenge"(id,slug,title,description,"interfaceText",difficulty,'
         '"parTokens","followupPrompt",models,status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
         (ids["ch"], slug, "t", "d", "def add(a, b) -> int", "easy", 1000, "f", ["m/x"], "published"))
    db.q('INSERT INTO "Attempt"(id,"userId","challengeId") VALUES (%s,%s,%s)',
         (ids["att"], ids["user"], ids["ch"]))
    db.q('INSERT INTO "Round"(id,"attemptId",index,"promptText") VALUES (%s,%s,0,%s)',
         (ids["rnd"], ids["att"], "write add"))
    db.q('INSERT INTO "Model"(id,"openrouterId","displayName","sizeTier") VALUES (%s,%s,%s,%s)',
         (ids["mdl"], str(uuid.uuid4()), "M", "small"))
    db.q('INSERT INTO "Run"(id,"roundId","modelId") VALUES (%s,%s,%s)',
         (ids["run"], ids["rnd"], ids["mdl"]))
    db.q('INSERT INTO "Job"(id,"runId",type) VALUES (%s,%s,%s)', (ids["job"], ids["run"], "generate"))
    return ids


def test_generate_then_test_chain_produces_facts(fixture_challenge):
    for t in ("generate", "test"):   # drain stale queue rows from other tests first
        while worker.work_one(t):
            pass
    ids = seed_run(fixture_challenge)
    worker.work_one("generate")   # claims + handles the generate job
    run = db.q('SELECT * FROM "Run" WHERE id=%s', (ids["run"],))[0]
    assert run["status"] == "testing" and "def add" in run["generatedCode"]
    assert run["promptTokens"] > 0
    worker.work_one("test")
    run = db.q('SELECT * FROM "Run" WHERE id=%s', (ids["run"],))[0]
    assert run["status"] == "done" and run["errorKind"] is None
    tests = db.q('SELECT * FROM "TestResult" WHERE "runId"=%s', (ids["run"],))
    assert len(tests) == 1 and tests[0]["passed"]  # round 0 → build suite only
    assert db.q('SELECT * FROM "BenchmarkResult" WHERE "runId"=%s', (ids["run"],))
    # R9: Attempt.totalTokens is the SCORING total (survivors only), written
    # once by the web app at completion (Task 15) -- NOT a judge-side running
    # spend counter. It must still read its INSERT default (0) after a full
    # generate+test cycle that clearly spent tokens (promptTokens > 0 above),
    # proving the judge writes per-run token facts to Run only and never
    # rolls them up into this column itself.
    att = db.q('SELECT "totalTokens" FROM "Attempt" WHERE id=%s', (ids["att"],))[0]
    assert att["totalTokens"] == 0


def test_round1_generate_uses_own_prior_code_and_test_includes_extend(fixture_challenge, monkeypatch):
    # Half the two-round scoring model, previously untested: handle_generate's
    # prior-code JOIN (round 1 must replay THIS model's own round-0 code as
    # the assistant turn, scoped by attemptId + modelId) and handle_test's
    # test_extend.py inclusion for round_index==1. The reviewer hand-traced
    # both as correct; this is regression protection, not a bug hunt.
    for t in ("generate", "test"):   # drain stale queue rows from other tests first
        while worker.work_one(t):
            pass
    ids = seed_run(fixture_challenge)  # round 0 (index 0) + its Run + a "generate" Job
    # Complete round 0 directly rather than running the real chain -- that
    # path is already covered by the test above; this test isolates round 1's
    # own wiring. Drop the leftover round-0 "generate" Job so it can't be
    # claimed instead of round 1's below (FIFO would pick it first).
    round0_code = "def add(a, b):\n    return a + b  # round0 marker\n"
    db.q('UPDATE "Run" SET "generatedCode"=%s, status=%s WHERE id=%s', (round0_code, "done", ids["run"]))
    db.q('DELETE FROM "Job" WHERE id=%s', (ids["job"],))

    rnd1, run1, job1 = (str(uuid.uuid4()) for _ in range(3))
    db.q('INSERT INTO "Round"(id,"attemptId",index,"promptText") VALUES (%s,%s,1,%s)',
         (rnd1, ids["att"], "extend it"))
    db.q('INSERT INTO "Run"(id,"roundId","modelId") VALUES (%s,%s,%s)', (run1, rnd1, ids["mdl"]))
    db.q('INSERT INTO "Job"(id,"runId",type) VALUES (%s,%s,%s)', (job1, run1, "generate"))

    # OPENROUTER_MOCK ignores the messages it's given (always returns the
    # reference solution), so the only way to observe what handle_generate
    # actually built is to spy on the call, not on generate()'s return value.
    captured = {}
    real_generate = worker.generate

    def spy_generate(openrouter_id, messages, slug):
        captured["messages"] = messages
        return real_generate(openrouter_id, messages, slug)

    monkeypatch.setattr(worker, "generate", spy_generate)
    worker.work_one("generate")

    assistant_turns = [m["content"] for m in captured["messages"] if m["role"] == "assistant"]
    assert assistant_turns and round0_code in assistant_turns[0]  # this model's own round-0 code, not a placeholder

    worker.work_one("test")
    tests = db.q('SELECT name, passed FROM "TestResult" WHERE "runId"=%s', (run1,))
    names = {t["name"].split("::")[-1] for t in tests}
    assert names == {"test_add", "test_neg"}  # test_build.py AND test_extend.py both ran
    assert all(t["passed"] for t in tests)
    run1_row = db.q('SELECT status, "errorKind" FROM "Run" WHERE id=%s', (run1,))[0]
    assert run1_row["status"] == "done" and run1_row["errorKind"] is None


def _seed_jobs(job_type, n):
    """Lean seed for n Jobs of job_type, each on its own Run (sharing one
    user/challenge/attempt/round/model chain -- irrelevant to a queue test).
    Returns the n run ids in creation order (== FIFO claim order)."""
    uid, chid, aid, rid, mid = (str(uuid.uuid4()) for _ in range(5))
    db.q('INSERT INTO "User"(id,email,name,"passwordHash") VALUES (%s,%s,%s,%s)',
         (uid, f"{uid}@t.io", "t", "x"))
    db.q('INSERT INTO "Challenge"(id,slug,title,description,"interfaceText",difficulty,'
         '"parTokens","followupPrompt",models,status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
         (chid, chid, "t", "d", "i", "easy", 1000, "f", ["m"], "published"))
    db.q('INSERT INTO "Attempt"(id,"userId","challengeId") VALUES (%s,%s,%s)', (aid, uid, chid))
    db.q('INSERT INTO "Round"(id,"attemptId",index,"promptText") VALUES (%s,%s,0,%s)', (rid, aid, "p"))
    db.q('INSERT INTO "Model"(id,"openrouterId","displayName","sizeTier") VALUES (%s,%s,%s,%s)',
         (mid, str(uuid.uuid4()), "M", "small"))
    run_ids = [str(uuid.uuid4()) for _ in range(n)]
    for run_id in run_ids:
        db.q('INSERT INTO "Run"(id,"roundId","modelId") VALUES (%s,%s,%s)', (run_id, rid, mid))
        db.q('INSERT INTO "Job"(id,"runId",type) VALUES (%s,%s,%s)', (str(uuid.uuid4()), run_id, job_type))
    return run_ids


def test_concurrent_workers_never_double_claim_or_drop_jobs(monkeypatch):
    # FOR UPDATE SKIP LOCKED (db.claim_job, Task 4) only proves itself under
    # real concurrent contention -- a test that drives one worker at a time
    # proves nothing about it. A unique job_type isolates this test's queue
    # rows from every other test. The handler is stubbed (no sandbox/LLM
    # needed -- this is a claim-queue property, not a generate/test one) and
    # sleeps briefly to widen the window where several threads are genuinely
    # mid-job at once, the same technique runner.py's own concurrent-canary
    # test uses to force real overlap rather than hoping for it.
    job_type = f"conc-{uuid.uuid4().hex[:8]}"
    n = 20
    run_ids = _seed_jobs(job_type, n)

    processed = []
    lock = threading.Lock()

    def stub(run_id):
        time.sleep(0.01)
        with lock:
            processed.append(run_id)

    monkeypatch.setitem(worker.HANDLERS, job_type, stub)

    def drain():
        while worker.work_one(job_type):
            pass

    threads = [threading.Thread(target=drain) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert not any(t.is_alive() for t in threads)
    # every job claimed exactly once -- no duplicate claim, no dropped job
    assert sorted(processed) == sorted(run_ids)
    states = db.q('SELECT state FROM "Job" WHERE "runId" = ANY(%s::text[])', (run_ids,))
    assert len(states) == n and all(s["state"] == "done" for s in states)


def test_crashed_handler_fails_the_run_and_finishes_the_job_not_stuck(monkeypatch):
    # A handler that raises must not (a) kill its worker thread -- the pool
    # has to survive one bad run -- or (b) leave the run stuck mid-flight
    # forever (a swallowed exception with no resolution is just as bad).
    # work_one's except clause must resolve both explicitly: the Job reaches
    # a terminal state carrying the error (not left "claimed"), the Run
    # reaches a terminal status (error/platform, not "generating"/"testing"
    # forever), and work_one itself must still be callable afterwards.
    job_type = f"crash-{uuid.uuid4().hex[:8]}"
    bad_run, good_run = _seed_jobs(job_type, 2)

    def boom(run_id):
        raise RuntimeError("handler exploded")

    monkeypatch.setitem(worker.HANDLERS, job_type, boom)
    assert worker.work_one(job_type) is True  # job consumed despite the crash, not re-raised

    run = db.q('SELECT status, "errorKind", "errorMessage" FROM "Run" WHERE id=%s', (bad_run,))[0]
    assert run["status"] == "error" and run["errorKind"] == "platform"
    assert "handler exploded" in run["errorMessage"]
    job = db.q('SELECT state, error FROM "Job" WHERE "runId"=%s', (bad_run,))[0]
    assert job["state"] == "done"  # not left "claimed" forever
    assert "handler exploded" in job["error"]

    # the pool survives: a healthy job right after a crash still completes normally
    monkeypatch.setitem(worker.HANDLERS, job_type, lambda run_id: None)
    assert worker.work_one(job_type) is True
    assert db.q('SELECT state FROM "Job" WHERE "runId"=%s', (good_run,))[0]["state"] == "done"


def test_loop_survives_when_the_recovery_write_itself_raises(monkeypatch):
    # R42: work_one's except block calls _fail then db.finish_job(error=...),
    # and NEITHER call is itself protected -- the test above only proves
    # work_one survives a handler crash when recording that failure SUCCEEDS.
    # If the same DB blip that made the handler raise also makes the recovery
    # write raise, that second exception used to propagate out of work_one,
    # through _loop, and silently kill that daemon thread forever (a raised
    # daemon thread just stops -- nothing restarts it), leaving the Run
    # non-terminal and the Job stuck "claimed" (no stale-claim reclaim exists
    # anywhere in the judge). _loop itself -- not work_one -- must guard the
    # iteration, so drive this through a real _loop thread, not work_one
    # directly.
    job_type = f"doublefault-{uuid.uuid4().hex[:8]}"
    bad_run, good_run = _seed_jobs(job_type, 2)  # FIFO: bad_run claimed first

    def boom(run_id):
        raise RuntimeError("handler exploded")

    monkeypatch.setitem(worker.HANDLERS, job_type, boom)

    real_fail = worker._fail
    calls = {"n": 0}

    def flaky_fail(run_id, kind, message):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("recovery write also failed")  # the DB blip hits recovery too
        real_fail(run_id, kind, message)

    monkeypatch.setattr(worker, "_fail", flaky_fail)

    t = threading.Thread(target=worker._loop, args=(job_type,), daemon=True)
    t.start()
    # the bad job's own recovery write raises -- if _loop dies there, good_run
    # never gets claimed at all; poll instead of a fixed sleep since the fix
    # paces failed iterations with the same 1s the empty-queue path already uses
    deadline = time.time() + 10
    good_done = False
    while time.time() < deadline:
        rows = db.q('SELECT state FROM "Job" WHERE "runId"=%s', (good_run,))
        if rows and rows[0]["state"] == "done":
            good_done = True
            break
        time.sleep(0.05)

    assert t.is_alive()  # the thread is still looping, not dead from the propagated exception
    assert good_done  # ... and it kept processing jobs afterward, not just technically alive
    assert calls["n"] >= 1  # the flaky recovery path was actually exercised


@pytest.fixture()
def fixture_challenge_no_bench_sizes(tmp_path, monkeypatch):
    # run_bench returns (rows=[], None, None) for an empty SIZES challenge --
    # a clean success with zero rows. Prove the worker treats that as neither
    # an error nor (since the judge never computes perfScore at all -- Task
    # 15 does) a fabricated perfect score: just zero facts written.
    # Unique slug per run for the same reason as fixture_challenge above.
    slug = f"nobench-{uuid.uuid4().hex[:8]}"
    ch = tmp_path / slug
    (ch / "reference").mkdir(parents=True)
    (ch / "tests").mkdir()
    (ch / "benchmarks").mkdir()
    (ch / "reference" / "solution.py").write_text("def add(a, b):\n    return a + b\n")
    (ch / "tests" / "test_build.py").write_text(
        "from solution import add\ndef test_add():\n    assert add(1, 2) == 3\n")
    (ch / "benchmarks" / "bench.py").write_text(
        "import solution\nSIZES=[]\n"
        "def setup(s):\n    return None\n"
        "def run(d):\n    pass\n")
    monkeypatch.setenv("CHALLENGES_DIR", str(tmp_path))
    monkeypatch.setenv("OPENROUTER_MOCK", "1")
    return slug


def test_empty_bench_sizes_is_a_clean_done_with_zero_rows(fixture_challenge_no_bench_sizes):
    for t in ("generate", "test"):   # drain stale queue rows from other tests first
        while worker.work_one(t):
            pass
    ids = seed_run(fixture_challenge_no_bench_sizes)
    worker.work_one("generate")
    worker.work_one("test")
    run = db.q('SELECT * FROM "Run" WHERE id=%s', (ids["run"],))[0]
    assert run["status"] == "done" and run["errorKind"] is None and run["errorMessage"] is None
    assert db.q('SELECT * FROM "BenchmarkResult" WHERE "runId"=%s', (ids["run"],)) == []
