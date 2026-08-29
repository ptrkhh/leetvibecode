from solution import Index


def build(*docs):
    # Duplicated verbatim in test_extend.py: each suite is handed to the
    # sandbox on its own, with no conftest.py to share.
    ix = Index()
    for doc_id, text in docs:
        ix.add(doc_id, text)
    return ix


def test_matching_is_case_insensitive_both_ways():
    ix = build((1, "The Big Cat"))
    assert ix.search("cat") == [1]   # stored text must be folded
    assert ix.search("CAT") == [1]   # ...and so must the query
    assert ix.search("Big") == [1]


def test_punctuation_separates_terms():
    ix = build((1, "cat,dog;bird.  fish-eagle"))
    assert ix.search("cat") == [1]
    assert ix.search("dog") == [1]
    assert ix.search("bird") == [1]
    assert ix.search("eagle") == [1]


def test_results_are_ascending_doc_ids():
    ix = build((5, "cat"), (2, "cat"), (9, "cat"))
    assert ix.search("cat") == [2, 5, 9]


def test_repeated_term_yields_one_id():
    ix = build((1, "cat cat cat"))
    assert ix.search("cat") == [1]


def test_unknown_term_returns_empty_list():
    ix = build((1, "cat"))
    assert ix.search("zebra") == []


def test_substring_is_not_a_match():
    ix = build((1, "category catalog"))
    assert ix.search("cat") == []
    assert ix.search("category") == [1]


def test_terms_do_not_leak_between_documents():
    ix = build((1, "cat"), (2, "dog"))
    assert ix.search("cat") == [1]
    assert ix.search("dog") == [2]


def test_digits_belong_to_terms():
    ix = build((1, "GPU2 costs $400"))
    assert ix.search("gpu2") == [1]
    assert ix.search("400") == [1]
    assert ix.search("gpu") == []
