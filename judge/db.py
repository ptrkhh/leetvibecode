import os
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

pool = ConnectionPool(os.environ["DATABASE_URL"], min_size=1, max_size=10, open=True,
                      kwargs={"row_factory": dict_row})


def q(sql: str, params: tuple = ()) -> list[dict]:
    with pool.connection() as conn:
        cur = conn.execute(sql, params)
        return cur.fetchall() if cur.description else []


CLAIM_SQL = """
UPDATE "Job" SET state='claimed', "claimedBy"=%s, "claimedAt"=now()
WHERE id = (
  SELECT id FROM "Job"
  WHERE state='pending' AND type=%s
  ORDER BY "createdAt"
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING id, "runId"
"""


def claim_job(job_type: str, worker_id: str) -> dict | None:
    rows = q(CLAIM_SQL, (worker_id, job_type))
    return rows[0] if rows else None


def finish_job(job_id: str, error: str | None = None) -> None:
    q('UPDATE "Job" SET state=%s, error=%s WHERE id=%s', ("done", error, job_id))


def requeue_stale_claims(timeout_s: int) -> list[str]:
    """R86: a Job stuck 'claimed' past timeout_s means the process that
    claimed it died before ever calling finish_job/_fail (OOM kill, a
    `docker compose restart judge`, a host reboot) -- nothing else reads
    claimedAt, so without this the Job (and its Run) stays claimed and
    non-terminal forever and the player's dashboard polls an attempt that
    can never complete. Reset it to 'pending' so an ordinary claim_job
    picks it up again and the handler runs from scratch. Returns the
    reclaimed job ids (for logging/tests).

    A plain UPDATE ... WHERE, not a claim, so it needs no FOR UPDATE SKIP
    LOCKED and is safe to run from several judge processes at once with no
    extra coordination: Postgres row-locks whichever rows a concurrent
    UPDATE touches, and the moment any one process flips a row's state
    away from 'claimed', every other process's identical WHERE stops
    matching that row. Nothing here needs a stale job requeued by exactly
    one sweeper -- only that it ends up 'pending' at least once, which any
    number of overlapping sweeps already guarantee.
    """
    rows = q('''
        UPDATE "Job" SET state='pending', "claimedBy"=NULL, "claimedAt"=NULL
        WHERE state='claimed' AND "claimedAt" < now() - make_interval(secs => %s)
        RETURNING id''', (timeout_s,))
    return [r["id"] for r in rows]
