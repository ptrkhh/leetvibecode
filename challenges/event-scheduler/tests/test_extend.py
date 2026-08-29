from solution import Scheduler


def recorder():
    """(log, make) -- make(tag) builds a zero-argument callback that appends
    tag to log when it runs."""
    log = []
    return log, lambda tag: lambda: log.append(tag)


def test_a_recurring_event_fires_once_per_interval():
    log, make = recorder()
    s = Scheduler()
    s.schedule(0.25, make("tick"), every_s=0.25)
    for now in (0.3, 0.6, 0.8, 1.1):     # due at 0.25, 0.5, 0.75, 1.0
        assert s.run_due(now) == 1
    assert log == ["tick"] * 4


def test_one_call_runs_a_recurring_event_once_and_skips_missed_ticks():
    log, make = recorder()
    s = Scheduler()
    s.schedule(0.0, make("t"), every_s=0.25)
    assert s.run_due(0.0) == 1     # fires at `at` itself
    assert s.run_due(2.0) == 1     # eight intervals elapsed -> still one run
    assert log == ["t", "t"]
    assert s.run_due(2.1) == 0     # next tick is 2.25, not a replayed backlog
    assert s.run_due(2.25) == 1


def test_cancel_stops_a_recurring_event_for_good():
    log, make = recorder()
    s = Scheduler()
    event_id = s.schedule(0.5, make("t"), every_s=0.5)
    assert s.run_due(0.5) == 1
    assert s.cancel(event_id)      # the id stays valid across repeats
    assert s.run_due(100.0) == 0
    assert log == ["t"]


def test_one_shot_events_are_unchanged():
    log, make = recorder()
    s = Scheduler()
    s.schedule(1.0, make("once"))
    s.schedule(2.0, make("also-once"), every_s=None)
    assert s.run_due(5.0) == 2
    assert s.run_due(9.0) == 0
    assert log == ["once", "also-once"]


def test_repeats_take_their_turn_in_time_order_with_one_shots():
    log, make = recorder()
    s = Scheduler()
    s.schedule(0.25, make("r"), every_s=0.5)   # 0.25, 0.75, 1.25, 1.75, ...
    s.schedule(0.5, make("a"))
    s.schedule(1.0, make("b"))
    assert s.run_due(0.6) == 2
    assert log == ["r", "a"]
    assert s.run_due(1.3) == 2                 # the 0.75 repeat, then b
    assert log == ["r", "a", "r", "b"]
    assert s.run_due(1.8) == 1                 # next repeat is 1.75, not 1.25
    assert log == ["r", "a", "r", "b", "r"]
