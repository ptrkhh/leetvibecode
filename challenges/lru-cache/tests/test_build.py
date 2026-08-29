from solution import LRUCache


def test_get_of_a_missing_key_returns_none():
    c = LRUCache(2)
    assert c.get("nope") is None


def test_put_then_get_returns_the_stored_value():
    c = LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    assert c.get("a") == 1
    assert c.get("b") == 2


def test_nothing_is_evicted_below_capacity():
    # Off-by-one guard: holding exactly `capacity` entries is full, not
    # over-full, so nothing may be dropped yet.
    c = LRUCache(3)
    for i, k in enumerate("abc", 1):
        c.put(k, i)
    assert [c.get(k) for k in "abc"] == [1, 2, 3]


def test_evicts_the_least_recently_used_not_the_first_inserted():
    # The whole point: reading "a" makes "b" the eviction candidate, so a
    # plain insertion-ordered queue gets this wrong.
    c = LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    assert c.get("a") == 1   # "a" is now the most recently used
    c.put("c", 3)            # over capacity -> "b" must go
    assert c.get("b") is None
    assert c.get("a") == 1
    assert c.get("c") == 3


def test_overwriting_a_key_updates_it_counts_as_a_use_and_does_not_grow():
    c = LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    c.put("a", 99)           # new value AND a use of "a"
    c.put("c", 3)            # evicts the LRU entry, which is now "b"
    assert c.get("a") == 99
    assert c.get("b") is None
    assert c.get("c") == 3


def test_the_cache_stays_bounded_under_many_writes():
    c = LRUCache(2)
    for i in range(100):
        c.put(i, i)
    assert [c.get(i) for i in range(100)] == [None] * 98 + [98, 99]


def test_falsy_values_are_cached_not_reported_as_misses():
    # A hit is decided by whether the key is present, never by whether its
    # value is truthy.
    c = LRUCache(3)
    c.put("zero", 0)
    c.put("empty", "")
    assert c.get("zero") == 0
    assert c.get("empty") == ""
