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
