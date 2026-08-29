from solution import LRUCache


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_an_entry_expires_once_its_ttl_has_elapsed():
    # The clock walks in fractional steps rather than one whole-second jump:
    # an implementation that floors elapsed time to whole seconds, or that
    # ignores the injected clock and reads the wall clock, survives a single
    # big integer jump unnoticed but not this.
    clock = FakeClock()
    c = LRUCache(4, clock)
    c.put("a", 1, ttl_s=1.0)
    for _ in range(3):
        clock.t += 0.3       # 0.3, 0.6, 0.9 -- all still inside the ttl
        assert c.get("a") == 1
    clock.t += 0.3           # 1.2 -- past it
    assert c.get("a") is None


def test_the_ttl_is_measured_from_the_put_not_from_time_zero():
    clock = FakeClock()
    clock.t = 5.5
    c = LRUCache(4, clock)
    c.put("a", 1, ttl_s=1.0)   # expires at 6.5, not at 1.0
    clock.t = 6.4
    assert c.get("a") == 1
    clock.t = 6.5   # the expiry instant itself already misses
    assert c.get("a") is None


def test_entries_stored_without_a_ttl_never_expire():
    clock = FakeClock()
    c = LRUCache(4, clock)
    c.put("forever", 1)
    c.put("brief", 2, ttl_s=0.5)
    clock.t = 1_000_000.0
    assert c.get("forever") == 1
    assert c.get("brief") is None


def test_lru_eviction_still_works_when_entries_carry_a_ttl():
    clock = FakeClock()
    c = LRUCache(2, clock)
    c.put("a", 1, ttl_s=100.0)
    c.put("b", 2)
    assert c.get("a") == 1     # "b" is now the least recently used
    c.put("c", 3, ttl_s=100.0)
    assert c.get("b") is None
    assert c.get("a") == 1
    assert c.get("c") == 3


def test_the_clock_argument_is_optional():
    # One-argument construction is existing behaviour and must keep working:
    # the clock defaults to time.monotonic. The ttl here is far longer than
    # any plausible test runtime, so this asserts caching, not expiry.
    c = LRUCache(2)
    c.put("a", 1)
    c.put("b", 2, ttl_s=3600.0)
    assert c.get("a") == 1
    assert c.get("b") == 2


def test_a_sub_second_ttl_expires_on_time():
    # R76: every other ttl_s in this file is a whole number, and for an
    # integer ttl `floor(elapsed) >= ttl` is identical to `elapsed >= ttl` --
    # so an implementation that truncates elapsed time to whole seconds
    # ("avoiding float precision issues") is invisible to them. A fractional
    # ttl checked either side of its own fractional boundary is what exposes
    # it: quantized, a 0.5s entry survives until the next whole second, and a
    # 0.01s entry outlives its ttl a hundredfold.
    clock = FakeClock()
    c = LRUCache(4, clock)
    c.put("half", 1, ttl_s=0.5)     # expires at 0.5
    clock.t = 0.4
    assert c.get("half") == 1
    clock.t = 0.6
    assert c.get("half") is None
    # Same again with a fractional put time, so neither end of the
    # subtraction is a whole number.
    clock.t = 1.25
    c.put("quarter", 2, ttl_s=0.25)  # expires at 1.5
    clock.t = 1.4
    assert c.get("quarter") == 2
    clock.t = 1.6
    assert c.get("quarter") is None
