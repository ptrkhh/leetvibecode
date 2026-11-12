import random


def make_input():
    rng = random.Random(11)
    return [(rng.random() < 0.6, rng.randrange(0, 4000)) for _ in range(120000)]


def run(namespace, data):
    cache = namespace["LRUCache"](1000)
    get, put = cache.get, cache.put
    for is_get, key in data:
        if is_get:
            get(key)
        else:
            put(key, key)
