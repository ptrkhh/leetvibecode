import re

# Terms are maximal runs of letters/digits; everything else separates.
_TERM = re.compile(r"[a-z0-9]+")


class Index:
    def __init__(self):
        # term -> {doc_id: [positions]}. The documents themselves are never
        # kept, and each distinct term is stored once; the positions are what
        # phrase queries need.
        self._index: dict[str, dict[int, list[int]]] = {}

    def add(self, doc_id: int, text: str) -> None:
        for pos, term in enumerate(_TERM.findall(text.lower())):
            self._index.setdefault(term, {}).setdefault(doc_id, []).append(pos)

    def search(self, term: str) -> list[int]:
        q = term.strip()
        if len(q) >= 2 and q[0] == '"' and q[-1] == '"':
            return self._phrase(_TERM.findall(q.lower()))
        return sorted(self._index.get(q.lower(), ()))

    def _phrase(self, terms: list[str]) -> list[int]:
        if not terms:
            return []
        out = []
        for doc_id, positions in self._index.get(terms[0], {}).items():
            starts = set(positions)
            for offset, term in enumerate(terms[1:], 1):
                later = self._index.get(term, {}).get(doc_id)
                if not later:
                    starts = None
                    break
                starts &= {p - offset for p in later}
                if not starts:
                    starts = None
                    break
            if starts:
                out.append(doc_id)
        return sorted(out)
