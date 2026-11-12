def make_input():
    return [i * 0.0007 for i in range(150000)]


def run(namespace, data):
    allow = namespace["RateLimiter"](rate=900, capacity=50).allow
    for now in data:
        allow(now)
