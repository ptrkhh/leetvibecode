import heapq


def _order(jobs, deps):
    """The one legal order, computed before anything runs so a cycle can be
    refused without side effects: Kahn's algorithm over a heap, which pops the
    alphabetically first job whose dependencies are all done."""
    unmet = {name: len(deps.get(name, ())) for name in jobs}
    dependents: dict[str, list[str]] = {name: [] for name in jobs}
    for name in jobs:
        for dep in deps.get(name, ()):
            dependents[dep].append(name)

    ready = [name for name, n in unmet.items() if not n]
    heapq.heapify(ready)
    order = []
    while ready:
        name = heapq.heappop(ready)
        order.append(name)
        for child in dependents[name]:
            unmet[child] -= 1
            if not unmet[child]:
                heapq.heappush(ready, child)
    if len(order) != len(jobs):
        raise ValueError("dependency cycle among " +
                         ", ".join(sorted(set(jobs) - set(order))))
    return order


def run_dag(jobs, deps):
    order = _order(jobs, deps)
    for name in order:
        jobs[name]()          # a failure is the caller's problem in round 1
    return order


def run_dag_report(jobs, deps):
    status = {}
    for name in _order(jobs, deps):
        if any(status[dep] != "ok" for dep in deps.get(name, ())):
            status[name] = "skipped"
            continue
        try:
            jobs[name]()
        except Exception:
            status[name] = "failed"
        else:
            status[name] = "ok"
    return status
