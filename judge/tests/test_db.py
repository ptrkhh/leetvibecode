import uuid
import db


def make_job(job_type="generate"):
    uid, chid, aid, rid, mid, runid, jobid = (str(uuid.uuid4()) for _ in range(7))
    db.q('INSERT INTO "User"(id,email,name,"passwordHash") VALUES (%s,%s,%s,%s)',
         (uid, f"{uid}@t.io", "t", "x"))
    db.q('INSERT INTO "Challenge"(id,slug,title,description,"interfaceText",difficulty,'
         '"parTokens","followupPrompt",models,status) '
         "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
         (chid, chid, "t", "d", "i", "easy", 1000, "f", ["m"], "published"))
    db.q('INSERT INTO "Attempt"(id,"userId","challengeId") VALUES (%s,%s,%s)', (aid, uid, chid))
    db.q('INSERT INTO "Round"(id,"attemptId",index,"promptText") VALUES (%s,%s,0,%s)', (rid, aid, "p"))
    db.q('INSERT INTO "Model"(id,"openrouterId","displayName","sizeTier") VALUES (%s,%s,%s,%s)',
         (mid, str(uuid.uuid4()), "M", "small"))
    db.q('INSERT INTO "Run"(id,"roundId","modelId") VALUES (%s,%s,%s)', (runid, rid, mid))
    db.q('INSERT INTO "Job"(id,"runId",type) VALUES (%s,%s,%s)', (jobid, runid, job_type))
    return jobid, runid


def test_claim_returns_pending_job_and_marks_claimed():
    # R58: unique type string, same isolation the sibling test below already
    # uses. CLAIM_SQL is pure FIFO over a SHARED queue, so with the literal
    # "generate" any older pending job left by another task's fixtures wins
    # the race and the id assertion below fails against a row this test never
    # created -- a flake with nothing to do with the code under test.
    job_type = f"claim-{uuid.uuid4().hex[:8]}"
    jobid, runid = make_job(job_type)
    job = db.claim_job(job_type, "w1")
    assert job is not None and job["id"] == jobid and job["runId"]
    rows = db.q('SELECT state,"claimedBy" FROM "Job" WHERE id=%s', (job["id"],))
    assert rows[0]["state"] == "claimed" and rows[0]["claimedBy"] == "w1"


def test_claim_is_type_scoped_and_finish_completes():
    # unique type string isolates this test from any leftover queue rows
    unique_type = f"t-{uuid.uuid4().hex[:8]}"
    other_type = f"other-{unique_type}"
    assert db.claim_job(unique_type, "w") is None
    # other_type job created first (FIFO-earliest) so it would be wrongly claimed
    # below if the type filter were ever dropped from CLAIM_SQL
    other_jobid, _ = make_job(other_type)
    make_job(unique_type)
    job = db.claim_job(unique_type, "w2")
    assert job is not None
    db.finish_job(job["id"])
    assert db.q('SELECT state FROM "Job" WHERE id=%s', (job["id"],))[0]["state"] == "done"
    assert db.claim_job(unique_type, "w2") is None  # nothing left of that type
    # the other-typed job must have been left untouched by the claims above
    other_job = db.claim_job(other_type, "w3")
    assert other_job is not None and other_job["id"] == other_jobid
