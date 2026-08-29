"""Benchmark: one full scan-and-project over a list of row dicts.

The workload is fixed by construction, not emergent. The rows are built
deterministically in setup(), so the predicate matches exactly the same
one-in-twelve rows for every submission on every host -- the number of
comparisons and the number of projected rows never depend on wall time, on
the host's speed, or on the submission's own behaviour.

`query` is called with the same keyword convention the hidden suites use, so
anything that passes the tests can also be benchmarked.
"""
import solution

SIZES = [20_000, 80_000]
WHERE = {"status": "open", "region": "eu"}
SELECT = ["id", "status", "amount"]

_STATUS = ["open", "closed", "pending", "archived"]
_REGION = ["eu", "us", "apac"]


def setup(size):
    return [{"id": i,
             "status": _STATUS[i % 4],
             "region": _REGION[i % 3],
             "amount": i % 97,
             "owner": "team-%d" % (i % 7),
             "note": "row"} for i in range(size)]


def run(rows):
    solution.query(rows, where=WHERE, select=SELECT)
