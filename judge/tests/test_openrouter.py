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


def test_generate_empty_choices_retries_then_raises_platform_error(monkeypatch):
    # R23: a 200 with "choices": [] is a real OpenRouter/OpenAI-compatible shape
    # (filtered/degenerate completion). It must be a retryable platform fault,
    # not an uncaught IndexError escaping on the first attempt.
    monkeypatch.delenv("OPENROUTER_MOCK", raising=False)  # R17
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json={"choices": [], "usage": {"prompt_tokens": 1, "completion_tokens": 1}})
    monkeypatch.setattr(openrouter, "_client", canned(handler))
    monkeypatch.setattr(openrouter.time, "sleep", lambda s: None)
    with pytest.raises(PlatformError):
        openrouter.generate("m/x", [{"role": "user", "content": "hi"}], "slug")
    assert calls["n"] == 3  # initial + 2 retries, same budget as any other platform fault


def test_generate_null_usage_succeeds_with_zero_tokens(monkeypatch):
    # R23 judgment call: null prompt_tokens/completion_tokens (key present, value
    # None) is a degenerate-but-usable response — real code came back, only the
    # metering is missing. Treat it as success reporting 0/0 rather than burning
    # 3 attempts + backoff on a response that already has a usable answer; 0 also
    # undercounts rather than overcounts against the token cap/quota.
    monkeypatch.delenv("OPENROUTER_MOCK", raising=False)  # R17
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "```python\nok\n```"}}],
            "usage": {"prompt_tokens": None, "completion_tokens": None}})
    monkeypatch.setattr(openrouter, "_client", canned(handler))
    text, pt, ct = openrouter.generate("m/x", [{"role": "user", "content": "hi"}], "slug")
    assert "ok" in text and (pt, ct) == (0, 0)


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
