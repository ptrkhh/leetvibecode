import hashlib

import pytest

from solution import BlobStore

# Duplicated verbatim in test_build.py: each suite is handed to the sandbox
# on its own, with no conftest.py to share.
BINARY = b"\x00\xffPK\x03\x04\x80\x81 not utf-8 \xfe\xff\x00"


def test_blob_survives_until_the_last_delete():
    st = BlobStore()
    h = st.put(b"shared")
    st.put(b"shared")
    st.put(b"shared")
    st.delete(h)
    st.delete(h)
    assert st.get(h) == b"shared"   # two of three copies released
    assert st.blob_count() == 1
    st.delete(h)
    assert st.blob_count() == 0
    with pytest.raises(KeyError):
        st.get(h)


def test_delete_raises_when_nothing_is_stored():
    st = BlobStore()
    h = st.put(b"once")
    st.delete(h)
    with pytest.raises(KeyError):
        st.delete(h)                # already released
    with pytest.raises(KeyError):
        st.delete("0" * 64)         # never stored


def test_counts_are_per_content():
    st = BlobStore()
    a = st.put(b"alpha")
    st.put(b"alpha")
    b = st.put(b"beta!")
    st.delete(b)
    assert st.blob_count() == 1
    with pytest.raises(KeyError):
        st.get(b)
    assert st.get(a) == b"alpha"    # untouched by beta's delete
    st.delete(a)
    assert st.get(a) == b"alpha"


def test_storing_again_after_release_starts_a_fresh_count():
    st = BlobStore()
    h = st.put(BINARY)
    st.delete(h)
    assert st.put(BINARY) == h
    assert st.get(h) == BINARY
    assert st.blob_count() == 1
    st.delete(h)
    assert st.blob_count() == 0


def test_dedup_and_hashing_still_hold_around_a_delete():
    st = BlobStore()
    h = st.put(b"hello world")
    assert h == hashlib.sha256(b"hello world").hexdigest()
    assert st.put(b"hello world") == h
    assert st.blob_count() == 1
    st.delete(h)                                 # one of the two copies
    assert st.put(b"hello world") == h           # same content, same hash
    assert st.blob_count() == 1                  # and still exactly one copy
    assert st.get(h) == b"hello world"
