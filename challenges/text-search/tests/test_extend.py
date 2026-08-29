from solution import Index


def build(*docs):
    # Duplicated verbatim in test_build.py: each suite is handed to the
    # sandbox on its own, with no conftest.py to share.
    ix = Index()
    for doc_id, text in docs:
        ix.add(doc_id, text)
    return ix


def test_phrase_matches_only_adjacent_terms_in_order():
    ix = build(
        (1, "the big cat sat"),    # adjacent, in order
        (2, "the cat big sat"),    # adjacent, wrong order
        (3, "big red cat"),        # in order, not adjacent
        (4, "big"),                # only one of the two terms
    )
    assert ix.search('"big cat"') == [1]


def test_phrase_folds_case_and_punctuation_like_indexed_text():
    # doc 5 is the guard: an implementation that folds the indexed text but
    # not the quoted query drops "BIG" as unmatchable, degrades to the
    # one-term phrase "cat", and answers [3, 5, 7] -- which is why the corpus
    # has to contain a document holding only the lowercase half.
    ix = build((7, "The BIG, Cat!"), (3, "a big cat"), (5, "a small cat"))
    assert ix.search('"BIG cat"') == [3, 7]


def test_phrase_of_three_terms_needs_the_whole_run():
    ix = build((1, "the big cat sat"), (2, "the big red cat"))
    assert ix.search('"the big cat"') == [1]
    assert ix.search('"big cat"') == [1]


def test_repeated_phrase_still_yields_one_id():
    ix = build((7, "cat big cat big cat"))
    assert ix.search('"big cat"') == [7]
    assert ix.search('"cat big"') == [7]


def test_unquoted_search_is_unchanged():
    ix = build((1, "the big cat sat"), (2, "big red cat"))
    assert ix.search("cat") == [1, 2]      # no adjacency requirement
    assert ix.search("CAT") == [1, 2]
    assert ix.search("category") == []
