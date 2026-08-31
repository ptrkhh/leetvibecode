import heapq
import itertools


class Scheduler:
    def __init__(self):
        self._due = []                  # heap of (at, seq, event_id)
        self._events = {}               # event_id -> (fn, every_s)
        self._seq = itertools.count()
        self._ids = itertools.count(1)

    def schedule(self, at: float, fn, every_s=None) -> int:
        event_id = next(self._ids)
        self._events[event_id] = (fn, every_s)
        heapq.heappush(self._due, (at, next(self._seq), event_id))
        return event_id

    def cancel(self, event_id) -> bool:
        # The heap entry is left behind as a tombstone and skipped when it
        # surfaces -- removing it would be O(n) on the hot path.
        return self._events.pop(event_id, None) is not None

    def run_due(self, now: float) -> int:
        ran = 0
        # Rescheduled repeats are collected and pushed only after the loop,
        # so one call can never run the same event twice.
        repeats = []
        while self._due and self._due[0][0] <= now:
            at, _, event_id = heapq.heappop(self._due)
            entry = self._events.get(event_id)
            if entry is None:
                continue                # cancelled before it came due
            fn, every_s = entry
            fn()
            ran += 1
            if every_s is None or every_s <= 0:
                del self._events[event_id]
                continue
            nxt = at + every_s          # skip whole missed intervals
            while nxt <= now:
                nxt += every_s
            repeats.append((nxt, next(self._seq), event_id))
        for item in repeats:
            heapq.heappush(self._due, item)
        return ran
