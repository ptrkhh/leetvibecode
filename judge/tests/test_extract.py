from extract import extract_code


def test_takes_last_python_block():
    text = "```python\nfirst\n```\nprose\n```python\nsecond\n```"
    assert extract_code(text) == "second"


def test_prefers_tagged_over_later_untagged():
    text = "```python\ncode\n```\n```\nnotes\n```"
    assert extract_code(text) == "code"


def test_falls_back_to_untagged():
    assert extract_code("```\nx = 1\n```") == "x = 1"


def test_ignores_other_languages_and_none_when_absent():
    assert extract_code("```json\n{}\n```") is None
    assert extract_code("no fences at all") is None
