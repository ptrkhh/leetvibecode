"""Store/lookup throughput on a fixed, half-duplicate workload.

Every submission does the same work: the same `size` payloads, built the same
way, half of them duplicates of an earlier blob, then one get() per put().
Nothing branches on how fast the submission is or on what it returns -- the
gets use the hashes put() handed back, so even a store that addresses content
differently than the tests require is benchmarked rather than crashed.

Round-1 API only: no delete(), which a round-1 submission does not have.

The store is constructed exactly as the hidden suites construct it --
BlobStore() with no arguments, put(data) and get(hash) positionally.
"""
import solution

SIZES = [20_000, 60_000]


def setup(size):
    # 136-byte payloads; blob i duplicates blob i-1 for every odd i, so the
    # dedup path and the fresh-store path each take exactly half the puts.
    return [b"payload-%08d-" % (i // 2) * 8 for i in range(size)]


def run(data):
    store = solution.BlobStore()
    hashes = [store.put(blob) for blob in data]
    for h in hashes:
        store.get(h)
