def _aggregate(func, column, group):
    if func == "count":
        return len(group)
    total = sum(row[column] for row in group)
    return total / len(group) if func == "avg" else total


def query(rows, where=None, select=None, group_by=None, agg=None):
    if where:
        rows = [r for r in rows
                if all(r.get(k) == v for k, v in where.items())]
    if group_by:
        groups = {}
        for r in rows:
            groups.setdefault(tuple(r[c] for c in group_by), []).append(r)
        rows = [dict(zip(group_by, key),
                     **{name: _aggregate(f, c, g) for name, (f, c) in (agg or {}).items()})
                for key, g in groups.items()]
    if select is not None:
        rows = [{c: r[c] for c in select if c in r} for r in rows]
    return list(rows)
