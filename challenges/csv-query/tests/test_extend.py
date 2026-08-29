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


def test_group_by_counts_the_rows_in_each_group():
    # Groups come out in first-encountered order: berlin (row 0) then paris.
    assert query(rows(), group_by=["city"], agg={"n": ("count", None)}) == [
        {"city": "berlin", "n": 3},
        {"city": "paris", "n": 1},
    ]
    # select projects the grouped rows, same as it projects plain ones.
    assert query(rows(), select=["n"], group_by=["city"],
                 agg={"n": ("count", None)}) == [{"n": 3}, {"n": 1}]


def test_sum_and_avg_aggregate_a_column_over_the_group():
    out = query(rows(), group_by=["city"],
                agg={"total": ("sum", "amount"), "mean": ("avg", "amount")})
    assert [r["city"] for r in out] == ["berlin", "paris"]
    assert out[0]["total"] == 17
    assert abs(out[0]["mean"] - 17 / 3) < 1e-9   # a true average, not 5
    assert out[1]["total"] == 5 and out[1]["mean"] == 5


def test_where_filters_before_grouping():
    assert query(rows(), where={"status": "open"}, group_by=["city"],
                 agg={"n": ("count", None)}) == [
        {"city": "berlin", "n": 2},
        {"city": "paris", "n": 1},
    ]


def test_grouping_by_several_columns_keys_on_the_combination():
    assert query(rows(), group_by=["city", "status"],
                 agg={"n": ("count", None)}) == [
        {"city": "berlin", "status": "open", "n": 2},
        {"city": "paris", "status": "open", "n": 1},
        {"city": "berlin", "status": "closed", "n": 1},
    ]


def test_queries_without_group_by_are_unchanged():
    assert query(rows(), where={"status": "closed"}, select=["id"]) == [{"id": 2}]
    assert query(rows()) == rows()
    assert query(rows(), where={"city": "tokyo"}) == []
