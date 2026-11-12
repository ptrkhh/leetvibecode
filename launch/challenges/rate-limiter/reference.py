class RateLimiter:
    def __init__(self, rate, capacity):
        self.rate = rate
        self.capacity = capacity
        self.tokens = float(capacity)
        self.last = None

    def _refill(self, now):
        if self.last is not None:
            self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
        self.last = now

    def available(self, now):
        self._refill(now)
        return self.tokens

    def allow(self, now, cost=1):
        self._refill(now)
        if self.tokens >= cost:
            self.tokens -= cost
            return True
        return False
