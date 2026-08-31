from solution import PubSub


def recorder():
    """(log, cb) -- cb is a one-argument callback appending to log."""
    log = []
    return log, log.append


def test_a_wildcard_receives_every_topic_one_segment_below_it():
    bus = PubSub()
    log, cb = recorder()
    bus.subscribe("orders.*", cb)
    assert bus.publish("orders.created", 1) == 1
    assert bus.publish("orders.paid", 2) == 1
    assert log == [1, 2]


def test_a_wildcard_matches_exactly_one_extra_segment():
    bus = PubSub()
    log, cb = recorder()
    bus.subscribe("orders.*", cb)
    assert bus.publish("orders", "no extra segment") == 0
    assert bus.publish("orders.eu.created", "two extra segments") == 0
    assert bus.publish("billing.created", "another prefix") == 0
    assert log == []
    assert bus.publish("orders.created", "one extra segment") == 1   # and the boundary the other way
    assert log == ["one extra segment"]


def test_exact_and_wildcard_subscribers_share_one_delivery_order():
    bus = PubSub()
    order = []
    bus.subscribe("orders.*", lambda msg: order.append("wild-first"))
    bus.subscribe("orders.created", lambda msg: order.append("exact"))
    bus.subscribe("orders.*", lambda msg: order.append("wild-last"))
    assert bus.publish("orders.created", None) == 3
    assert order == ["wild-first", "exact", "wild-last"]


def test_a_wildcard_subscription_unsubscribes_like_any_other():
    bus = PubSub()
    log, cb = recorder()
    sub = bus.subscribe("orders.*", cb)
    assert bus.publish("orders.created", 1) == 1
    sub.unsubscribe()
    assert bus.publish("orders.created", 2) == 0
    assert log == [1]


def test_exact_topics_still_behave_exactly_as_before():
    bus = PubSub()
    log, cb = recorder()
    other, cb_other = recorder()
    bus.subscribe("news", cb)
    sub = bus.subscribe("news", cb_other)
    assert bus.publish("news", "a") == 2
    sub.unsubscribe()
    assert bus.publish("news", "b") == 1
    assert bus.publish("sport", "c") == 0
    assert log == ["a", "b"]
    assert other == ["a"]
