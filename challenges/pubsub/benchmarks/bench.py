"""Benchmark: the cost of one publish() on the delivery path.

The workload is fixed by construction, not emergent. setup() wires exactly
two subscribers onto each of TOPICS topics and builds the publish sequence
up front, so every publish delivers exactly two messages and every
submission performs the same number of lookups and callbacks, on every
host. Nothing branches on wall time, on the host's speed, or on the
submission's own behaviour.

The bus is constructed and driven exactly as the hidden suites do it:
PubSub() with no arguments, subscribe(topic, cb) and publish(topic, msg)
positionally.
"""
import solution

SIZES = [20_000, 80_000]
TOPICS = 32


def _sink(msg):
    pass


def setup(size):
    bus = solution.PubSub()
    for i in range(TOPICS):
        bus.subscribe("events.%d" % i, _sink)
        bus.subscribe("events.%d" % i, _sink)
    return bus, ["events.%d" % (i % TOPICS) for i in range(size)]


def run(data):
    bus, topics = data
    for topic in topics:
        bus.publish(topic, 1)
