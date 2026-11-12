import random


def make_input():
    rng = random.Random(7)
    intervals = []
    for _ in range(60000):
        start = rng.randrange(0, 1_000_000)
        intervals.append((start, start + rng.randrange(1, 40)))
    return intervals


def run(namespace, data):
    namespace["merge_intervals"](data)
