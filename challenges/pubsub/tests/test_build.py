from solution import PubSub


def recorder():
    """(log, cb) -- cb is a one-argument callback appending to log."""
    log = []
    return log, log.append


def test_delivers_only_to_subscribers_of_that_topic():
    bus = PubSub()
    news, cb_news = recorder()
    sport, cb_sport = recorder()
    bus.subscribe("news", cb_news)
    bus.subscribe("sport", cb_sport)
    bus.publish("news", "hello")
    assert news == ["hello"]
    assert sport == []


def test_publish_returns_the_number_of_callbacks_it_called():
    bus = PubSub()
    log, cb = recorder()
    assert bus.publish("news", 1) == 0     # nobody is listening yet
    bus.subscribe("news", cb)
    bus.subscribe("news", cb)
    assert bus.publish("news", 2) == 2
    assert log == [2, 2]


def test_topics_are_created_lazily_on_first_use():
    # No declare step: publishing to a topic nobody has touched is a no-op,
    # and subscribing to a brand new topic just works.
    bus = PubSub()
    log, cb = recorder()
    assert bus.publish("never.seen", "x") == 0
    bus.subscribe("brand.new", cb)
    assert bus.publish("brand.new", "y") == 1
    assert log == ["y"]


def test_subscribers_are_called_in_subscription_order():
    bus = PubSub()
    order = []
    for tag in "abc":
        bus.subscribe("t", lambda msg, tag=tag: order.append(tag))
    bus.publish("t", None)
    assert order == ["a", "b", "c"]


def test_unsubscribe_stops_only_that_subscription():
    bus = PubSub()
    gone, cb_gone = recorder()
    kept, cb_kept = recorder()
    sub = bus.subscribe("t", cb_gone)
    bus.subscribe("t", cb_kept)
    sub.unsubscribe()
    assert bus.publish("t", 1) == 1
    assert gone == []
    assert kept == [1]


def test_one_callback_subscribed_twice_is_two_separate_subscriptions():
    bus = PubSub()
    log, cb = recorder()
    first = bus.subscribe("t", cb)
    bus.subscribe("t", cb)
    first.unsubscribe()                    # removes one, not both
    assert bus.publish("t", "m") == 1
    assert log == ["m"]


def test_unsubscribing_twice_is_harmless():
    bus = PubSub()
    gone, cb_gone = recorder()
    kept, cb_kept = recorder()
    sub = bus.subscribe("t", cb_gone)
    bus.subscribe("t", cb_kept)
    sub.unsubscribe()
    sub.unsubscribe()
    assert bus.publish("t", 1) == 1
    assert kept == [1]


def test_the_message_object_is_handed_over_unchanged():
    bus = PubSub()
    log, cb = recorder()
    bus.subscribe("t", cb)
    payload = {"id": 1}
    bus.publish("t", payload)
    assert log[0] is payload
