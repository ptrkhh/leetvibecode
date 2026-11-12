def test_entry_expires_after_ttl():
    cache = LRUCache(2)
    cache.put("a", 1, ttl=10, now=0.0)
    assert cache.get("a", now=5.0) == 1
    assert cache.get("a", now=10.0) is None


def test_entry_without_ttl_never_expires():
    cache = LRUCache(2)
    cache.put("a", 1, now=0.0)
    assert cache.get("a", now=1e9) == 1


def test_put_replaces_the_ttl():
    cache = LRUCache(2)
    cache.put("a", 1, ttl=10, now=0.0)
    cache.put("a", 2, ttl=10, now=8.0)
    assert cache.get("a", now=15.0) == 2
    assert cache.get("a", now=18.0) is None


def test_put_without_ttl_removes_the_old_ttl():
    cache = LRUCache(2)
    cache.put("a", 1, ttl=5, now=0.0)
    cache.put("a", 2, now=1.0)
    assert cache.get("a", now=100.0) == 2


def test_ttl_and_eviction_work_together():
    cache = LRUCache(2)
    cache.put("a", 1, ttl=100, now=0.0)
    cache.put("b", 2, now=1.0)
    assert cache.get("a", now=2.0) == 1
    cache.put("c", 3, now=3.0)
    assert cache.get("b", now=4.0) is None
    assert cache.get("a", now=4.0) == 1
    assert cache.get("c", now=4.0) == 3


def test_calls_without_ttl_or_now_still_work():
    cache = LRUCache(1)
    cache.put("a", 1)
    assert cache.get("a") == 1
    cache.put("b", 2)
    assert cache.get("a") is None
