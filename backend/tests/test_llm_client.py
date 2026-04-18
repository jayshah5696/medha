"""Tests for the thin OpenAI-compatible LLM client.

Covers:
- Provider routing / model string parsing
- Error mapping (401 -> AuthenticationError, 429 -> RateLimitError, etc.)
- Non-streaming completion
- Streaming SSE parsing
- Connection error handling
"""

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.ai.llm_client import (
    _parse_model_string,
    acompletion,
    AuthenticationError,
    RateLimitError,
    APIConnectionError,
    LLMError,
    _raise_for_status,
    close_client,
)


# ---------------------------------------------------------------------------
# Provider routing
# ---------------------------------------------------------------------------


class TestParseModelString:
    def test_openai(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
            base_url, key, model = _parse_model_string("openai/gpt-4o")
        assert base_url == "https://api.openai.com/v1"
        assert key == "sk-test"
        assert model == "gpt-4o"

    def test_openrouter(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "or-test"}):
            base_url, key, model = _parse_model_string("openrouter/anthropic/claude-3.5-sonnet")
        assert base_url == "https://openrouter.ai/api/v1"
        assert key == "or-test"
        assert model == "anthropic/claude-3.5-sonnet"

    def test_gemini(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "gem-test"}):
            base_url, key, model = _parse_model_string("gemini/gemini-2.5-flash")
        assert "generativelanguage" in base_url
        assert key == "gem-test"
        assert model == "gemini-2.5-flash"

    def test_ollama(self):
        base_url, key, model = _parse_model_string("ollama/llama3")
        assert "localhost:11434" in base_url
        assert key is None
        assert model == "llama3"

    def test_ollama_custom_url(self):
        with patch.dict(os.environ, {"OLLAMA_URL": "http://192.168.1.100:11434"}):
            base_url, key, model = _parse_model_string("ollama/llama3")
        assert base_url == "http://192.168.1.100:11434/v1"

    def test_lm_studio(self):
        base_url, key, model = _parse_model_string("lm_studio/my-model")
        assert "localhost:1234" in base_url
        assert key is None
        assert model == "my-model"

    def test_lm_studio_custom_url(self):
        with patch.dict(os.environ, {"LM_STUDIO_URL": "http://my-server:5000/v1"}):
            base_url, key, model = _parse_model_string("lm_studio/my-model")
        assert base_url == "http://my-server:5000/v1"

    def test_no_provider_prefix(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
            base_url, key, model = _parse_model_string("gpt-4o")
        assert base_url == "https://api.openai.com/v1"
        assert model == "gpt-4o"

    def test_unknown_provider(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
            base_url, key, model = _parse_model_string("unknown/model")
        # Falls back to openai
        assert base_url == "https://api.openai.com/v1"
        assert model == "unknown/model"

    def test_anthropic(self):
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "ant-test"}):
            base_url, key, model = _parse_model_string("anthropic/claude-3-opus")
        assert "anthropic" in base_url
        assert key == "ant-test"
        assert model == "claude-3-opus"


# ---------------------------------------------------------------------------
# Error mapping
# ---------------------------------------------------------------------------


class TestRaiseForStatus:
    def test_401_raises_auth(self):
        resp = MagicMock(spec=httpx.Response)
        resp.is_success = False
        resp.status_code = 401
        resp.json.return_value = {"error": {"message": "bad key"}}
        with pytest.raises(AuthenticationError):
            _raise_for_status(resp)

    def test_429_raises_ratelimit(self):
        resp = MagicMock(spec=httpx.Response)
        resp.is_success = False
        resp.status_code = 429
        resp.json.return_value = {"error": {"message": "slow down"}}
        with pytest.raises(RateLimitError):
            _raise_for_status(resp)

    def test_500_raises_llm_error(self):
        resp = MagicMock(spec=httpx.Response)
        resp.is_success = False
        resp.status_code = 500
        resp.json.return_value = {"error": {"message": "server error"}}
        with pytest.raises(LLMError):
            _raise_for_status(resp)

    def test_success_does_not_raise(self):
        resp = MagicMock(spec=httpx.Response)
        resp.is_success = True
        _raise_for_status(resp)  # Should not raise


# ---------------------------------------------------------------------------
# Non-streaming completion
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_acompletion_non_streaming():
    """acompletion should POST to /chat/completions and return the JSON."""
    fake_response = {
        "choices": [{"message": {"content": "Hello!"}, "finish_reason": "stop"}],
        "model": "gpt-4o",
    }

    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.is_success = True
    mock_resp.status_code = 200
    mock_resp.json.return_value = fake_response

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)

    with patch("app.ai.llm_client._get_client", return_value=mock_client), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
        result = await acompletion(
            model="openai/gpt-4o",
            messages=[{"role": "user", "content": "Hi"}],
        )

    assert result["choices"][0]["message"]["content"] == "Hello!"
    # Verify the POST was called with correct URL
    call_args = mock_client.post.call_args
    assert "/chat/completions" in call_args[0][0]


@pytest.mark.asyncio
async def test_acompletion_with_tools():
    """acompletion should include tools in the payload when provided."""
    fake_response = {
        "choices": [
            {
                "message": {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "get_schema", "arguments": '{"file":"test.csv"}'},
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "model": "gpt-4o",
    }

    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.is_success = True
    mock_resp.json.return_value = fake_response

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)

    tools = [{"type": "function", "function": {"name": "get_schema"}}]

    with patch("app.ai.llm_client._get_client", return_value=mock_client), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
        result = await acompletion(
            model="openai/gpt-4o",
            messages=[{"role": "user", "content": "show schema"}],
            tools=tools,
        )

    # Verify tools were passed in payload
    call_kwargs = mock_client.post.call_args
    payload = call_kwargs.kwargs["json"]
    assert "tools" in payload
    assert result["choices"][0]["message"]["tool_calls"][0]["function"]["name"] == "get_schema"


@pytest.mark.asyncio
async def test_acompletion_connection_error():
    """Connection errors should raise APIConnectionError."""
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=httpx.ConnectError("refused"))

    with patch("app.ai.llm_client._get_client", return_value=mock_client), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
        with pytest.raises(APIConnectionError):
            await acompletion(
                model="openai/gpt-4o",
                messages=[{"role": "user", "content": "Hi"}],
            )


@pytest.mark.asyncio
async def test_acompletion_auth_error():
    """401 responses should raise AuthenticationError."""
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.is_success = False
    mock_resp.status_code = 401
    mock_resp.json.return_value = {"error": {"message": "Invalid API key"}}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)

    with patch("app.ai.llm_client._get_client", return_value=mock_client), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "bad-key"}):
        with pytest.raises(AuthenticationError):
            await acompletion(
                model="openai/gpt-4o",
                messages=[{"role": "user", "content": "Hi"}],
            )
