from solution import RateLimiter


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_keys_are_independent():
    rl = RateLimiter(1.0, 2.0, FakeClock())
    assert rl.allow(key="a") and rl.allow(key="a")
    assert not rl.allow(key="a")
    assert rl.allow(key="b") and rl.allow(key="b")


def test_default_key_backwards_compatible():
    rl = RateLimiter(1.0, 1.0, FakeClock())
    assert rl.allow()
    assert not rl.allow(key="default")  # bare call and "default" share a bucket


def test_unknown_key_starts_full():
    # rate 0, so a new key's allowances have to come from a full bucket and
    # cannot be a refill topping up an empty one.
    rl = RateLimiter(0.0, 3.0, FakeClock())
    assert sum(rl.allow(key="fresh") for _ in range(5)) == 3
