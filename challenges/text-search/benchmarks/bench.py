"""Indexing + lookup throughput.

The workload is fixed by construction: the same seeded corpus and the same
query list on every host and for every submission, so min(1, ref/sub) compares
speeds rather than two different amounts of work. Nothing here depends on what
the submission returns or on how fast it runs.

Read-heavy on purpose (8 lookups per document). A lookup costs roughly the
same whatever the postings hold; indexing does not, and the reference carries
the round-2 positional postings that a round-1 answer has no reason to build.
Measured at 1 lookup per document that made the reference 83% slower than the
same implementation without positions, handing every round-1 submission a free
perf score; at 8 it is 8-38% slower than four different correct round-1 forms,
so the bias still runs the player's way without erasing the measurement.

Document ids are inserted in shuffled order deliberately. Adding them 0,1,2...
leaves dict-shaped postings already in ascending order, so `sorted()` on them
is a linear timsort run while `sorted()` on an equally correct set of ids is
not -- measured, that one accident of corpus order alone made an otherwise
identical set-based index 3.3x slower. Shuffling makes every implementation
pay for the ordering the interface requires.

The index is constructed exactly as the hidden suites construct it: Index()
with no arguments, then add(doc_id, text) and search(term) positionally, and
no quoted queries -- a round-1 submission has no phrase support and would be
benchmarked on a cheaper workload than a round-2 one.
"""
import random

import solution

SIZES = [1_000, 4_000]
VOCAB = [f"w{i:04d}" for i in range(2_000)]
TERMS_PER_DOC = 24
QUERIES_PER_DOC = 8


def setup(size):
    rng = random.Random(20260829)
    doc_ids = list(range(size))
    random.Random(7).shuffle(doc_ids)
    docs = [(doc_ids[i], " ".join(rng.choice(VOCAB) for _ in range(TERMS_PER_DOC)))
            for i in range(size)]
    queries = [VOCAB[i % len(VOCAB)] for i in range(size * QUERIES_PER_DOC)]
    return docs, queries


def run(data):
    docs, queries = data
    ix = solution.Index()
    for doc_id, text in docs:
        ix.add(doc_id, text)
    for term in queries:
        ix.search(term)
