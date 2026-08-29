import hashlib

import pytest

from solution import BlobStore

# Duplicated verbatim in test_extend.py: each suite is handed to the sandbox
# on its own, with no conftest.py to share.
BINARY = b"\x00\xffPK\x03\x04\x80\x81 not utf-8 \xfe\xff\x00"


def test_roundtrip_returns_the_exact_bytes():
    st = BlobStore()
    assert st.get(st.put(b"hello world")) == b"hello world"


def test_hash_is_the_sha256_hex_of_the_content():
    st = BlobStore()
    other = BlobStore()
    assert st.put(b"hello world") == hashlib.sha256(b"hello world").hexdigest()
    # Content-addressed means the address comes from the content alone: a
    # second, independent store must name the same bytes the same way.
    assert other.put(b"hello world") == st.put(b"hello world")


def test_identical_content_is_stored_once():
    st = BlobStore()
    first = st.put(b"same")
    second = st.put(b"same")
    assert first == second
    assert st.blob_count() == 1
    st.put(b"different")
    assert st.blob_count() == 2


def test_distinct_contents_stay_independent():
    st = BlobStore()
    a, b = st.put(b"alpha"), st.put(b"beta!")  # same length, different bytes
    assert a != b
    assert st.get(a) == b"alpha"
    assert st.get(b) == b"beta!"


def test_get_unknown_hash_raises_keyerror():
    st = BlobStore()
    st.put(b"present")
    with pytest.raises(KeyError):
        st.get("0" * 64)


def test_empty_content_is_a_blob_like_any_other():
    st = BlobStore()
    h = st.put(b"")
    assert h == hashlib.sha256(b"").hexdigest()
    assert st.get(h) == b""
    assert st.blob_count() == 1


def test_arbitrary_binary_survives_unchanged():
    st = BlobStore()
    h = st.put(BINARY)
    assert st.get(h) == BINARY
    assert st.get(h) is not None and isinstance(st.get(h), bytes)
