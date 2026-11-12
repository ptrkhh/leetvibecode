def _merged(*args, **kwargs):
    return [tuple(item) for item in merge_intervals(*args, **kwargs)]


def test_gap_merges_nearby_intervals():
    assert _merged([(1, 3), (4, 6)], gap=1) == [(1, 6)]


def test_gap_too_small_keeps_intervals_apart():
    assert _merged([(1, 3), (6, 8)], gap=2) == [(1, 3), (6, 8)]


def test_gap_equal_to_distance_merges():
    assert _merged([(1, 3), (6, 8)], gap=3) == [(1, 8)]


def test_gap_defaults_to_zero():
    assert _merged([(1, 3), (4, 6)]) == [(1, 3), (4, 6)]


def test_gap_chains_across_several_intervals():
    assert _merged([(0, 1), (3, 4), (6, 7), (20, 21)], gap=2) == [(0, 7), (20, 21)]


def test_gap_can_be_passed_by_position():
    assert _merged([(1, 3), (4, 6)], 1) == [(1, 6)]
