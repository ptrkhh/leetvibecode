import time


class _Bucket:
    __slots__ = ("tokens", "last")

    def __init__(self, capacity: float, now: float):
        self.tokens = capacity
        self.last = now


class RateLimiter:
    def __init__(self, rate: float, capacity: float, clock=None):
        self.rate = rate
        self.capacity = capacity
        self.clock = clock or time.monotonic
        self._buckets: dict[str, _Bucket] = {}

    def allow(self, cost: float = 1.0, key: str = "default") -> bool:
        now = self.clock()
        b = self._buckets.get(key)
        if b is None:
            b = self._buckets[key] = _Bucket(self.capacity, now)
        b.tokens = min(self.capacity, b.tokens + (now - b.last) * self.rate)
        b.last = now
        if b.tokens >= cost:
            b.tokens -= cost
            return True
        return False
