def _merged(*args, **kwargs):
    return [tuple(item) for item in merge_intervals(*args, **kwargs)]


def test_empty_list():
    assert _merged([]) == []


def test_single_interval():
    assert _merged([(1, 2)]) == [(1, 2)]


def test_overlapping_intervals_merge():
    assert _merged([(1, 4), (2, 6)]) == [(1, 6)]


def test_touching_intervals_merge():
    assert _merged([(1, 3), (3, 5)]) == [(1, 5)]


def test_neighbouring_integers_stay_separate():
    assert _merged([(1, 3), (4, 6)]) == [(1, 3), (4, 6)]


def test_unsorted_input():
    assert _merged([(8, 10), (1, 3), (2, 6), (15, 18)]) == [(1, 6), (8, 10), (15, 18)]


def test_interval_inside_another():
    assert _merged([(1, 10), (2, 3), (4, 5)]) == [(1, 10)]


def test_chain_of_touching_intervals():
    assert _merged([(1, 2), (2, 3), (3, 4), (10, 11)]) == [(1, 4), (10, 11)]


def test_input_is_not_modified():
    data = [(5, 6), (1, 2), (2, 3)]
    merge_intervals(data)
    assert data == [(5, 6), (1, 2), (2, 3)]


def test_result_items_are_tuples():
    assert all(type(item) is tuple for item in merge_intervals([(1, 4), (2, 6), (9, 9)]))
