"""Edge case tests for llm_client — SSE parsing, concurrency, error paths.

These are all offline (mocked) tests covering tricky edge cases:
- SSE parsing with partial lines, empty data, multiple events in one chunk
- Concurrent requests sharing the same httpx.AsyncClient
- Timeout errors
- Malformed JSON in SSE chunks
- Missing API key behavior
- The loop-aware client recreation
"""

import asyncio
import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.ai.llm_client import (
    _parse_model_string,
    _get_client,
    acompletion,
    close_client,
    _stream_completion,
    AuthenticationError,
    RateLimitError,
    APIConnectionError,
    LLMError,
)


# ---------------------------------------------------------------------------
# SSE parsing edge cases
# ---------------------------------------------------------------------------


class TestSSEParsing:
    """Test the inline SSE parser in _stream_completion."""

    @pytest.mark.asyncio
    async def test_stream_normal_chunks(self):
        """Normal SSE: each chunk is a complete data line."""
        sse_lines = [
            b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            b'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
            b'data: [DONE]\n\n',
        ]

        mock_resp = AsyncMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200

        async def fake_aiter_bytes():
            for line in sse_lines:
                yield line

        mock_resp.aiter_bytes = fake_aiter_bytes

        mock_client = AsyncMock()

        # Use asynccontextmanager pattern for stream
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def fake_stream(*args, **kwargs):
            yield mock_resp

        mock_client.stream = fake_stream

        chunks = []
        async for chunk in _stream_completion(mock_client, "http://test/v1/chat/completions", {}, {}):
            chunks.append(chunk)

        assert len(chunks) == 2
        assert chunks[0]["choices"][0]["delta"]["content"] == "Hello"
        assert chunks[1]["choices"][0]["delta"]["content"] == " world"

    @pytest.mark.asyncio
    async def test_stream_split_across_chunks(self):
        """SSE data split across TCP chunks — lines arrive in pieces."""
        sse_parts = [
            b'data: {"choices":[{"delta":{"con',
            b'tent":"split"}}]}\n\n',
            b'data: [DONE]\n\n',
        ]

        mock_resp = AsyncMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200

        async def fake_aiter_bytes():
            for part in sse_parts:
                yield part

        mock_resp.aiter_bytes = fake_aiter_bytes

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def fake_stream(*args, **kwargs):
            yield mock_resp

        mock_client = AsyncMock()
        mock_client.stream = fake_stream

        chunks = []
        async for chunk in _stream_completion(mock_client, "http://test/v1/chat/completions", {}, {}):
            chunks.append(chunk)

        assert len(chunks) == 1
        assert chunks[0]["choices"][0]["delta"]["content"] == "split"

    @pytest.mark.asyncio
    async def test_stream_with_empty_lines(self):
        """SSE with empty lines between events (standard SSE format)."""
        sse_data = b'data: {"choices":[{"delta":{"content":"A"}}]}\n\n\n\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\ndata: [DONE]\n\n'

        mock_resp = AsyncMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200

        async def fake_aiter_bytes():
            yield sse_data

        mock_resp.aiter_bytes = fake_aiter_bytes

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def fake_stream(*args, **kwargs):
            yield mock_resp

        mock_client = AsyncMock()
        mock_client.stream = fake_stream

        chunks = []
        async for chunk in _stream_completion(mock_client, "http://test/v1/chat/completions", {}, {}):
            chunks.append(chunk)

        assert len(chunks) == 2

    @pytest.mark.asyncio
    async def test_stream_with_malformed_json(self):
        """Malformed JSON in SSE should be skipped, not crash."""
        sse_data = b'data: {not valid json}\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'

        mock_resp = AsyncMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200

        async def fake_aiter_bytes():
            yield sse_data

        mock_resp.aiter_bytes = fake_aiter_bytes

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def fake_stream(*args, **kwargs):
            yield mock_resp

        mock_client = AsyncMock()
        mock_client.stream = fake_stream

        chunks = []
        async for chunk in _stream_completion(mock_client, "http://test/v1/chat/completions", {}, {}):
            chunks.append(chunk)

        # Should have skipped the malformed line and parsed the valid one
        assert len(chunks) == 1
        assert chunks[0]["choices"][0]["delta"]["content"] == "ok"

    @pytest.mark.asyncio
    async def test_stream_multiple_events_in_one_tcp_chunk(self):
        """Multiple SSE events arriving in a single TCP read."""
        sse_data = (
            b'data: {"choices":[{"delta":{"content":"A"}}]}\n\n'
            b'data: {"choices":[{"delta":{"content":"B"}}]}\n\n'
            b'data: {"choices":[{"delta":{"content":"C"}}]}\n\n'
            b'data: [DONE]\n\n'
        )

        mock_resp = AsyncMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200

        async def fake_aiter_bytes():
            yield sse_data

        mock_resp.aiter_bytes = fake_aiter_bytes

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def fake_stream(*args, **kwargs):
            yield mock_resp

        mock_client = AsyncMock()
        mock_client.stream = fake_stream

        chunks = []
        async for chunk in _stream_completion(mock_client, "http://test/v1/chat/completions", {}, {}):
            chunks.append(chunk)

        assert len(chunks) == 3
        contents = [c["choices"][0]["delta"]["content"] for c in chunks]
        assert contents == ["A", "B", "C"]

    @pytest.mark.asyncio
    async def test_stream_connection_error(self):
        """Connection error during streaming should raise APIConnectionError."""
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def boom_stream(*args, **kwargs):
            raise httpx.ConnectError("refused")
            yield  # pragma: no cover

        mock_client = AsyncMock()
        mock_client.stream = boom_stream

        with pytest.raises(APIConnectionError):
            async for _ in _stream_completion(mock_client, "http://test/v1/chat/completions", {}, {}):
                pass

    @pytest.mark.asyncio
    async def test_stream_timeout_error(self):
        """Timeout during streaming should raise APIConnectionError."""
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def timeout_stream(*args, **kwargs):
            raise httpx.ReadTimeout("timed out")
            yield  # pragma: no cover

        mock_client = AsyncMock()
        mock_client.stream = timeout_stream

        with pytest.raises(APIConnectionError):
            async for _ in _stream_completion(mock_client, "http://test/v1/chat/completions", {}, {}):
                pass

    @pytest.mark.asyncio
    async def test_stream_server_error_in_sse(self):
        """Non-200 status on streaming response should raise LLMError."""
        mock_resp = AsyncMock()
        mock_resp.is_success = False
        mock_resp.status_code = 500
        mock_resp.json.return_value = {"error": {"message": "Internal server error"}}
        mock_resp.text = "Internal server error"

        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def error_stream(*args, **kwargs):
            yield mock_resp

        mock_client = AsyncMock()
        mock_client.stream = error_stream

        with pytest.raises(LLMError):
            async for _ in _stream_completion(mock_client, "http://test/v1/chat/completions", {}, {}):
                pass


# ---------------------------------------------------------------------------
# Client lifecycle / loop awareness
# ---------------------------------------------------------------------------


class TestClientLifecycle:
    @pytest.mark.asyncio
    async def test_get_client_returns_same_on_same_loop(self):
        """Same event loop → same client instance."""
        from app.ai import llm_client

        # Reset
        llm_client._client = None
        llm_client._client_loop_id = None

        c1 = _get_client()
        c2 = _get_client()
        assert c1 is c2

        # Cleanup
        await close_client()

    @pytest.mark.asyncio
    async def test_close_client_resets_state(self):
        """close_client() sets _client to None."""
        from app.ai import llm_client

        llm_client._client = None
        llm_client._client_loop_id = None

        _ = _get_client()
        assert llm_client._client is not None

        await close_client()
        assert llm_client._client is None
        assert llm_client._client_loop_id is None


# ---------------------------------------------------------------------------
# Concurrent requests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_completions():
    """Multiple concurrent acompletion calls should all succeed."""
    fake_response = {
        "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
        "model": "test",
    }
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.is_success = True
    mock_resp.json.return_value = fake_response

    call_count = 0

    async def counting_post(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.01)  # Simulate network latency
        return mock_resp

    mock_client = AsyncMock()
    mock_client.post = counting_post

    with patch("app.ai.llm_client._get_client", return_value=mock_client), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
        tasks = [
            acompletion(
                model="openai/gpt-4o",
                messages=[{"role": "user", "content": f"Request {i}"}],
            )
            for i in range(5)
        ]
        results = await asyncio.gather(*tasks)

    assert len(results) == 5
    assert call_count == 5
    assert all(r["choices"][0]["message"]["content"] == "ok" for r in results)


# ---------------------------------------------------------------------------
# Missing API key behavior
# ---------------------------------------------------------------------------


class TestMissingApiKey:
    def test_missing_key_returns_none(self):
        """Missing API key env var → api_key is None (sent as empty Bearer)."""
        with patch.dict(os.environ, {}, clear=True):
            _, key, _ = _parse_model_string("openai/gpt-4o")
        assert key is None

    def test_ollama_no_key_needed(self):
        """Ollama doesn't need an API key."""
        base_url, key, model = _parse_model_string("ollama/llama3")
        assert key is None
        assert model == "llama3"


# ---------------------------------------------------------------------------
# Payload construction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_payload_excludes_none_max_tokens():
    """When max_tokens is None, it should not appear in the payload."""
    captured_payload = {}

    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.is_success = True
    mock_resp.json.return_value = {"choices": [{"message": {"content": "x"}}]}

    async def capture_post(url, **kwargs):
        captured_payload.update(kwargs.get("json", {}))
        return mock_resp

    mock_client = AsyncMock()
    mock_client.post = capture_post

    with patch("app.ai.llm_client._get_client", return_value=mock_client), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
        await acompletion(
            model="openai/gpt-4o",
            messages=[{"role": "user", "content": "test"}],
            max_tokens=None,
        )

    assert "max_tokens" not in captured_payload


@pytest.mark.asyncio
async def test_payload_includes_max_tokens_when_set():
    """When max_tokens is set, it should appear in the payload."""
    captured_payload = {}

    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.is_success = True
    mock_resp.json.return_value = {"choices": [{"message": {"content": "x"}}]}

    async def capture_post(url, **kwargs):
        captured_payload.update(kwargs.get("json", {}))
        return mock_resp

    mock_client = AsyncMock()
    mock_client.post = capture_post

    with patch("app.ai.llm_client._get_client", return_value=mock_client), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
        await acompletion(
            model="openai/gpt-4o",
            messages=[{"role": "user", "content": "test"}],
            max_tokens=100,
        )

    assert captured_payload["max_tokens"] == 100


@pytest.mark.asyncio
async def test_payload_includes_tool_choice():
    """tool_choice should be forwarded to the payload."""
    captured_payload = {}

    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.is_success = True
    mock_resp.json.return_value = {"choices": [{"message": {"content": "x"}}]}

    async def capture_post(url, **kwargs):
        captured_payload.update(kwargs.get("json", {}))
        return mock_resp

    mock_client = AsyncMock()
    mock_client.post = capture_post

    with patch("app.ai.llm_client._get_client", return_value=mock_client), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
        await acompletion(
            model="openai/gpt-4o",
            messages=[{"role": "user", "content": "test"}],
            tools=[{"type": "function", "function": {"name": "test"}}],
            tool_choice="auto",
        )

    assert captured_payload["tool_choice"] == "auto"
    assert captured_payload["tools"][0]["function"]["name"] == "test"


@pytest.mark.asyncio
async def test_stream_flag_in_payload():
    """stream=True should set stream: true in the payload."""
    captured_payload = {}

    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.is_success = True

    async def fake_aiter_bytes():
        yield b'data: [DONE]\n\n'

    mock_resp.aiter_bytes = fake_aiter_bytes

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def capture_stream(method, url, **kwargs):
        captured_payload.update(kwargs.get("json", {}))
        yield mock_resp

    mock_client = AsyncMock()
    mock_client.stream = capture_stream

    with patch("app.ai.llm_client._get_client", return_value=mock_client), \
         patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
        gen = await acompletion(
            model="openai/gpt-4o",
            messages=[{"role": "user", "content": "test"}],
            stream=True,
        )
        async for _ in gen:
            pass

    assert captured_payload.get("stream") is True


# ---------------------------------------------------------------------------
# Error responses with non-JSON bodies
# ---------------------------------------------------------------------------


class TestErrorResponseFormats:
    @pytest.mark.asyncio
    async def test_non_json_error_body(self):
        """Error response with plain text body should still raise."""
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.is_success = False
        mock_resp.status_code = 502
        mock_resp.json.side_effect = Exception("not json")
        mock_resp.text = "Bad Gateway"

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("app.ai.llm_client._get_client", return_value=mock_client), \
             patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
            with pytest.raises(LLMError) as exc_info:
                await acompletion(
                    model="openai/gpt-4o",
                    messages=[{"role": "user", "content": "test"}],
                )
            assert "Bad Gateway" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_timeout_raises_api_connection_error(self):
        """httpx.TimeoutException should map to APIConnectionError."""
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=httpx.ReadTimeout("read timed out"))

        with patch("app.ai.llm_client._get_client", return_value=mock_client), \
             patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
            with pytest.raises(APIConnectionError, match="timed out"):
                await acompletion(
                    model="openai/gpt-4o",
                    messages=[{"role": "user", "content": "test"}],
                )
