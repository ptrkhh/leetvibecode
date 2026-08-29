import itertools


class Subscription:
    """Handle returned by PubSub.subscribe(). Knows its own bus, so new kinds
    of subscription can be added without changing how callers unsubscribe."""

    __slots__ = ("_bus", "topic", "cb", "seq")

    def __init__(self, bus, topic, cb, seq):
        self._bus = bus
        self.topic = topic
        self.cb = cb
        self.seq = seq

    def unsubscribe(self) -> None:
        self._bus._remove(self)


class PubSub:
    def __init__(self):
        self._subs: dict[str, list] = {}     # pattern -> subscriptions, in order
        self._seq = itertools.count()        # one global subscription order

    def subscribe(self, topic: str, cb) -> Subscription:
        sub = Subscription(self, topic, cb, next(self._seq))
        self._subs.setdefault(topic, []).append(sub)
        return sub

    def _remove(self, sub: Subscription) -> None:
        subs = self._subs.get(sub.topic)
        if subs is not None and sub in subs:
            subs.remove(sub)

    def _matching(self, topic: str) -> list:
        exact = self._subs.get(topic, ())
        prefix, dot, _ = topic.rpartition(".")
        wildcard = self._subs.get(prefix + ".*", ()) if dot else ()
        if not wildcard:
            return list(exact)
        # One ordering across both kinds, by when each subscription was made.
        return sorted([*exact, *wildcard], key=lambda s: s.seq)

    def publish(self, topic: str, msg) -> int:
        # Snapshot first: a callback may subscribe or unsubscribe mid-delivery.
        targets = self._matching(topic)
        for sub in targets:
            sub.cb(msg)
        return len(targets)
