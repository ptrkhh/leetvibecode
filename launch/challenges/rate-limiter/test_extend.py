def _close(a, b):
    return abs(a - b) < 1e-9


def test_cost_consumes_several_tokens():
    limiter = RateLimiter(rate=1, capacity=5)
    assert limiter.allow(0.0, cost=3) is True
    assert limiter.allow(0.0, cost=3) is False
    assert limiter.allow(0.0, cost=2) is True


def test_cost_is_all_or_nothing():
    limiter = RateLimiter(rate=1, capacity=2)
    assert limiter.allow(0.0, cost=3) is False
    assert limiter.allow(0.0, cost=2) is True


def test_cost_defaults_to_one():
    limiter = RateLimiter(rate=1, capacity=2)
    assert limiter.allow(0.0) is True
    assert _close(limiter.available(0.0), 1.0)


def test_available_does_not_consume():
    limiter = RateLimiter(rate=1, capacity=4)
    assert _close(limiter.available(0.0), 4.0)
    assert _close(limiter.available(0.0), 4.0)
    assert limiter.allow(0.0, cost=4) is True
    assert _close(limiter.available(0.0), 0.0)


def test_available_reflects_refill_and_capacity():
    limiter = RateLimiter(rate=2, capacity=10)
    assert limiter.allow(0.0, cost=10) is True
    assert _close(limiter.available(1.5), 3.0)
    assert _close(limiter.available(100.0), 10.0)


def test_cost_can_be_passed_by_position():
    limiter = RateLimiter(1, 3)
    assert limiter.allow(0.0, 2) is True
    assert limiter.allow(0.0, 2) is False
