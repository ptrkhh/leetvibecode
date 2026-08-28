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
    jobid, runid = make_job()
    job = db.claim_job("generate", "w1")
    assert job is not None and job["runId"]
    rows = db.q('SELECT state,"claimedBy" FROM "Job" WHERE id=%s', (job["id"],))
    assert rows[0]["state"] == "claimed" and rows[0]["claimedBy"] == "w1"


def test_claim_is_type_scoped_and_finish_completes():
    # unique type string isolates this test from any leftover queue rows
    unique_type = f"t-{uuid.uuid4().hex[:8]}"
    assert db.claim_job(unique_type, "w") is None
    make_job(unique_type)
    job = db.claim_job(unique_type, "w2")
    assert job is not None
    db.finish_job(job["id"])
    assert db.q('SELECT state FROM "Job" WHERE id=%s', (job["id"],))[0]["state"] == "done"
    assert db.claim_job(unique_type, "w2") is None  # nothing left of that type
