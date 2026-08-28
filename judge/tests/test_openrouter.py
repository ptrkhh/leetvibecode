import httpx
import pytest
import openrouter
from openrouter import PlatformError, build_messages


def canned(handler):
    return httpx.Client(transport=httpx.MockTransport(handler), base_url="https://openrouter.ai/api/v1")


def test_build_messages_round0_has_system_and_contract():
    msgs = build_messages("def f(): ...", "make it", 0, None, None)
    assert msgs[0]["role"] == "system"
    assert "def f()" in msgs[1]["content"] and "make it" in msgs[1]["content"]
    assert len(msgs) == 2


def test_build_messages_round1_continues_own_conversation():
    msgs = build_messages("iface", "p0", 1, "x = 1", "add burst")
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    assert "```python\nx = 1\n```" in msgs[2]["content"]
    assert msgs[3]["content"] == "add burst"


def test_generate_returns_text_and_usage(monkeypatch):
    # R17: root .env sets OPENROUTER_MOCK=1, which generate() checks before ever
    # touching _client. Without delenv this test would silently take the mock
    # branch and never exercise the HTTP path it claims to test.
    monkeypatch.delenv("OPENROUTER_MOCK", raising=False)
    # Sandbox has no real key; the header line reads os.environ[...] directly,
    # so an unset key would KeyError (caught by the retry loop) before the
    # mocked client is ever called. Set a dummy so the real path is reached.
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "```python\nok\n```"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
    monkeypatch.setattr(openrouter, "_client", canned(handler))
    text, pt, ct = openrouter.generate("m/x", [{"role": "user", "content": "hi"}], "slug")
    assert "ok" in text and (pt, ct) == (10, 5)


def test_generate_retries_then_raises_platform_error(monkeypatch):
    monkeypatch.delenv("OPENROUTER_MOCK", raising=False)  # R17
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(500)
    monkeypatch.setattr(openrouter, "_client", canned(handler))
    sleeps = []
    monkeypatch.setattr(openrouter.time, "sleep", lambda s: sleeps.append(s))
    with pytest.raises(PlatformError):
        openrouter.generate("m/x", [{"role": "user", "content": "hi"}], "slug")
    assert calls["n"] == 3  # initial + 2 retries
    assert sleeps == [2, 4]  # R17c: backoff between attempts, none after the final failure


def test_generate_mock_mode_returns_reference_solution(tmp_path, monkeypatch):
    # R17b: mock mode is what Task 23's E2E run depends on (returns each
    # challenge's reference solution, zero token spend). Point CHALLENGES_DIR
    # at a throwaway fixture since no real challenges exist yet.
    code = "def solve():\n    return 42\n"
    ref_dir = tmp_path / "some-slug" / "reference"
    ref_dir.mkdir(parents=True)
    (ref_dir / "solution.py").write_text(code)
    monkeypatch.setenv("CHALLENGES_DIR", str(tmp_path))
    monkeypatch.setenv("OPENROUTER_MOCK", "1")

    text, pt, ct = openrouter.generate("any/model", [{"role": "user", "content": "hi"}], "some-slug")

    assert text == f"```python\n{code}\n```"
    assert (pt, ct) == (50, max(1, len(code) // 4))
