import hashlib


class BlobStore:
    def __init__(self):
        self._blobs: dict[str, bytes] = {}
        self._refs: dict[str, int] = {}

    def put(self, data: bytes) -> str:
        h = hashlib.sha256(data).hexdigest()
        if h not in self._blobs:
            self._blobs[h] = data
        self._refs[h] = self._refs.get(h, 0) + 1
        return h

    def get(self, hash: str) -> bytes:
        return self._blobs[hash]

    def blob_count(self) -> int:
        return len(self._blobs)

    def delete(self, hash: str) -> None:
        # KeyError here is the "nothing stored under that hash" case, which
        # covers both never-stored and already-fully-released.
        remaining = self._refs[hash] - 1
        if remaining:
            self._refs[hash] = remaining
        else:
            del self._refs[hash]
            del self._blobs[hash]
