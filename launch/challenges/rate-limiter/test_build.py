def test_bucket_starts_full():
    limiter = RateLimiter(rate=1, capacity=3)
    assert [limiter.allow(0.0) for _ in range(4)] == [True, True, True, False]


def test_tokens_refill_over_time():
    limiter = RateLimiter(rate=1, capacity=1)
    assert limiter.allow(0.0) is True
    assert limiter.allow(0.5) is False
    assert limiter.allow(1.5) is True


def test_bucket_never_exceeds_capacity():
    limiter = RateLimiter(rate=10, capacity=2)
    assert limiter.allow(0.0) is True
    assert limiter.allow(0.0) is True
    assert [limiter.allow(100.0) for _ in range(3)] == [True, True, False]


def test_fractional_rate_accumulates():
    limiter = RateLimiter(rate=0.5, capacity=1)
    assert limiter.allow(0.0) is True
    assert limiter.allow(1.0) is False
    assert limiter.allow(2.0) is True


def test_denied_request_consumes_nothing():
    limiter = RateLimiter(rate=1, capacity=1)
    assert limiter.allow(0.0) is True
    assert limiter.allow(0.25) is False
    assert limiter.allow(0.5) is False
    assert limiter.allow(1.0) is True


def test_instances_are_independent():
    first, second = RateLimiter(1, 1), RateLimiter(1, 1)
    assert first.allow(0.0) is True
    assert second.allow(0.0) is True


def test_first_call_can_use_any_timestamp():
    limiter = RateLimiter(rate=1, capacity=2)
    assert limiter.allow(1000.0) is True
    assert limiter.allow(1000.0) is True
    assert limiter.allow(1000.0) is False


def test_uses_given_timestamps_not_the_real_clock():
    limiter = RateLimiter(rate=1000, capacity=1)
    assert limiter.allow(5.0) is True
    assert limiter.allow(5.0) is False
