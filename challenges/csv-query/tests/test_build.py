from solution import query


def rows():
    """A fresh copy per test: no test may be affected by another test's
    input, however a submission treats it."""
    return [
        {"id": 3, "city": "berlin", "status": "open", "amount": 10},
        {"id": 1, "city": "paris", "status": "open", "amount": 5},
        {"id": 2, "city": "berlin", "status": "closed", "amount": 7},
        {"id": 4, "city": "berlin", "status": "open", "amount": 0},
    ]


def test_where_requires_every_pair_to_match_and_keeps_input_order():
    # Two pairs: paris fails the city, the closed row fails the status. The
    # survivors come back in input order (id 3 before id 4), not sorted.
    assert query(rows(), where={"city": "berlin", "status": "open"}) == [
        {"id": 3, "city": "berlin", "status": "open", "amount": 10},
        {"id": 4, "city": "berlin", "status": "open", "amount": 0},
    ]


def test_a_row_missing_a_where_column_is_skipped_not_an_error():
    assert query([{"a": 1}, {"a": 1, "b": 2}], where={"b": 2}) == [{"a": 1, "b": 2}]


def test_an_absent_or_empty_where_matches_every_row():
    assert query(rows()) == rows()
    assert query(rows(), where={}) == rows()


def test_where_compares_values_not_truthiness():
    # amount 0 is a real value to match on, not an absent one.
    assert query(rows(), where={"amount": 0}) == [
        {"id": 4, "city": "berlin", "status": "open", "amount": 0}]


def test_select_keeps_only_the_listed_columns():
    assert query(rows(), where={"status": "closed"}, select=["id", "amount"]) == [
        {"id": 2, "amount": 7}]


def test_select_none_keeps_every_column():
    assert query(rows(), where={"id": 1}) == [
        {"id": 1, "city": "paris", "status": "open", "amount": 5}]


def test_no_match_returns_an_empty_list():
    assert query(rows(), where={"city": "tokyo"}) == []


def test_the_input_rows_are_left_untouched():
    data = rows()
    before = rows()
    query(data, where={"city": "berlin"}, select=["id"])
    assert data == before
