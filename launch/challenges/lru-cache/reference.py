from collections import OrderedDict


class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.items = OrderedDict()  # key -> (value, expires_at or None)

    def get(self, key, now=0.0):
        entry = self.items.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at is not None and now >= expires_at:
            del self.items[key]
            return None
        self.items.move_to_end(key)
        return value

    def put(self, key, value, ttl=None, now=0.0):
        self.items[key] = (value, None if ttl is None else now + ttl)
        self.items.move_to_end(key)
        if len(self.items) > self.capacity:
            self.items.popitem(last=False)
