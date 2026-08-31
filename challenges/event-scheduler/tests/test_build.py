from solution import Scheduler


def recorder():
    """(log, make) -- make(tag) builds a zero-argument callback that appends
    tag to log when it runs."""
    log = []
    return log, lambda tag: lambda: log.append(tag)


def test_runs_only_the_events_that_are_due():
    log, make = recorder()
    s = Scheduler()
    s.schedule(1.5, make("early"))
    s.schedule(2.5, make("late"))
    assert s.run_due(2.0) == 1
    assert log == ["early"]
    assert s.run_due(3.0) == 1
    assert log == ["early", "late"]


def test_runs_in_time_order_not_in_schedule_order():
    log, make = recorder()
    s = Scheduler()
    s.schedule(3.0, make("c"))
    s.schedule(1.0, make("a"))
    s.schedule(2.0, make("b"))
    assert s.run_due(5.0) == 3
    assert log == ["a", "b", "c"]


def test_events_with_equal_times_run_in_schedule_order():
    log, make = recorder()
    s = Scheduler()
    for tag in "abc":
        s.schedule(1.0, make(tag))
    assert s.run_due(1.0) == 3
    assert log == ["a", "b", "c"]


def test_the_due_boundary_is_inclusive():
    log, make = recorder()
    s = Scheduler()
    s.schedule(1.0, make("x"))
    assert s.run_due(0.999) == 0
    assert log == []
    assert s.run_due(1.0) == 1


def test_fractional_times_are_not_rounded_to_whole_seconds():
    # Every event sits strictly between two whole seconds and `now` advances
    # in small fractional steps. An implementation that rounds, floors or
    # int()s either the event time or `now` runs the wrong set here, while
    # surviving whole-second test data unnoticed.
    log, make = recorder()
    s = Scheduler()
    for i in range(1, 6):
        s.schedule(i * 0.2, make(i))     # 0.2, 0.4, 0.6, 0.8, 1.0
    assert s.run_due(0.25) == 1
    assert s.run_due(0.55) == 1
    assert s.run_due(0.95) == 2
    assert s.run_due(1.5) == 1
    assert log == [1, 2, 3, 4, 5]


def test_an_event_never_runs_twice():
    log, make = recorder()
    s = Scheduler()
    s.schedule(1.0, make("x"))
    assert s.run_due(2.0) == 1
    assert s.run_due(3.0) == 0
    assert log == ["x"]


def test_cancel_removes_one_pending_event_and_reports_honestly():
    # Also pins that ids identify a single event: cancelling `a` must not
    # take `b` with it.
    log, make = recorder()
    s = Scheduler()
    a = s.schedule(1.0, make("a"))
    b = s.schedule(1.0, make("b"))
    assert s.cancel(a)
    assert not s.cancel(a)              # already cancelled
    assert not s.cancel("no-such-id")   # never existed
    assert s.run_due(5.0) == 1
    assert log == ["b"]
    assert not s.cancel(b)              # already run
