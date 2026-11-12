def test_missing_key_returns_none():
    assert LRUCache(2).get("x") is None


def test_put_then_get():
    cache = LRUCache(2)
    cache.put("a", 1)
    assert cache.get("a") == 1


def test_evicts_least_recently_used():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    assert cache.get("a") is None
    assert cache.get("b") == 2
    assert cache.get("c") == 3


def test_get_counts_as_use():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1
    cache.put("c", 3)
    assert cache.get("b") is None
    assert cache.get("a") == 1
    assert cache.get("c") == 3


def test_put_on_existing_key_updates_value_and_counts_as_use():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("a", 10)
    cache.put("c", 3)
    assert cache.get("a") == 10
    assert cache.get("b") is None


def test_updating_a_key_does_not_evict():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("b", 20)
    assert cache.get("a") == 1
    assert cache.get("b") == 20


def test_capacity_of_one():
    cache = LRUCache(1)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") is None
    assert cache.get("b") == 2


def test_falsy_values_are_stored():
    cache = LRUCache(2)
    cache.put("zero", 0)
    cache.put("empty", "")
    assert cache.get("zero") == 0
    assert cache.get("empty") == ""


def test_keys_can_be_any_hashable():
    cache = LRUCache(2)
    cache.put(1, "one")
    cache.put((2, 3), "pair")
    assert cache.get(1) == "one"
    assert cache.get((2, 3)) == "pair"
