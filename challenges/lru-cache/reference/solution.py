import time
from collections import OrderedDict


class LRUCache:
    def __init__(self, capacity: int, clock=None):
        self.capacity = capacity
        self.clock = clock or time.monotonic
        self._entries: OrderedDict = OrderedDict()  # key -> (value, expires_at|None)

    def get(self, key):
        entry = self._entries.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at is not None and self.clock() >= expires_at:
            del self._entries[key]
            return None
        self._entries.move_to_end(key)
        return value

    def put(self, key, value, ttl_s=None) -> None:
        self._entries[key] = (value, None if ttl_s is None else self.clock() + ttl_s)
        self._entries.move_to_end(key)
        if len(self._entries) > self.capacity:
            self._entries.popitem(last=False)
