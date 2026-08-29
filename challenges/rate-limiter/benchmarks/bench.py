"""Hot-path benchmark: cost of one allow() call.

Deliberately deterministic. A counter clock (+1us per read) and a capacity
larger than max(SIZES) mean every one of the `size` calls takes the allow
path -- on every host, for every submission. With a real clock and a small
capacity the bucket drains and the allow/deny split becomes a function of how
fast the host and the submission happen to be: measured, three correct
implementations ran 26%, 33% and 39% of their calls on the (more expensive)
allow path, so min(1, reference_time/submission_time) would be comparing
different workloads rather than different speeds.

The clock is passed POSITIONALLY, exactly as the hidden suites construct the
object, so anything that passes the tests can also be benchmarked.
"""
import itertools

import solution

SIZES = [50_000, 200_000]
RATE = 1_000_000.0
CAPACITY = 1_000_000.0  # > max(SIZES), so the bucket can never empty


def setup(size):
    clock = itertools.count(0.0, 1e-6).__next__
    return solution.RateLimiter(RATE, CAPACITY, clock), size


def run(data):
    rl, size = data
    for _ in range(size):
        rl.allow()
