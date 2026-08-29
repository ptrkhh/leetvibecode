"""Hot-path benchmark: the cost of one put() and one get().

The workload is fixed by construction, not emergent. `size` puts of distinct
keys into a cache of capacity size//2 perform exactly size - size//2
evictions whatever the eviction policy is, and the get() loop only replays
the most recently written half, so every submission performs the same number
of puts, evictions and hits on every host. Nothing here branches on wall
time, on the host's speed, or on the submission's own speed.

The cache is constructed with ONE positional argument, exactly as the hidden
suites construct it, so anything that passes the tests can also be
benchmarked.
"""
import solution

SIZES = [40_000, 160_000]


def setup(size):
    keys = list(range(size))
    half = size // 2
    return half, keys, keys[half:]


def run(data):
    capacity, keys, resident = data
    cache = solution.LRUCache(capacity)
    for k in keys:
        cache.put(k, k)
    for k in resident:
        cache.get(k)
