from solution import RateLimiter


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def make(rate=1.0, capacity=5.0):
    clock = FakeClock()
    return RateLimiter(rate, capacity, clock), clock


def test_starts_full_and_denies_when_empty():
    rl, _ = make()
    assert all(rl.allow() for _ in range(5))
    assert not rl.allow()


def test_refills_over_time():
    rl, clock = make(rate=2.0, capacity=5.0)
    for _ in range(5):
        rl.allow()
    clock.t = 1.0  # +2 tokens
    assert rl.allow() and rl.allow() and not rl.allow()


def test_continuous_fractional_refill_not_quantized():
    # Every other clock jump in this file is a whole number, which a limiter
    # that floors its refill (int tokens, or whole-second ticks) survives
    # unnoticed. Small fractional steps are what expose it: 0.4s at 2/s is
    # 0.8 of a token, and flooring that to 0 stalls the bucket forever.
    rl, clock = make(rate=2.0, capacity=1.0)
    assert rl.allow()  # drain the initial full bucket first
    allowed = 0
    for _ in range(10):
        clock.t += 0.4
        if rl.allow():
            allowed += 1
    assert allowed == 5


def test_refill_caps_at_capacity():
    rl, clock = make(rate=100.0, capacity=3.0)
    # Spend one FIRST: the bucket has to already exist when the clock jumps,
    # or dt is 0 on its first call and there is no refill for the cap to clamp.
    assert rl.allow()
    clock.t = 1000.0
    assert sum(rl.allow() for _ in range(10)) == 3  # 100k tokens' worth, capped at 3


def test_fractional_cost_and_no_partial_consumption():
    rl, _ = make(capacity=1.0)
    assert not rl.allow(cost=1.5)   # denied, nothing consumed
    assert rl.allow(cost=1.0)       # bucket still full


def test_denied_call_consumes_nothing():
    rl, clock = make(rate=0.0, capacity=2.0)
    rl.allow(); rl.allow()
    assert not rl.allow()
    assert not rl.allow(cost=0.5)  # empty bucket denies fractional cost too
    clock.t = 10.0  # rate 0 -> still empty
    assert not rl.allow()


def test_clock_argument_is_optional():
    # The published interface documents `clock=None` defaulting to
    # time.monotonic, so the two-argument form must construct. rate=0 keeps
    # the assertion independent of how much real time passes between calls.
    rl = RateLimiter(0.0, 1.0)
    assert rl.allow()
    assert not rl.allow()
