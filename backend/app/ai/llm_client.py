"""Thin async client for OpenAI-compatible chat completions.

Replaces litellm (65 MB, 733 modules) with ~150 lines of httpx.
Every major LLM provider exposes the same /v1/chat/completions
endpoint, so one HTTP client talks to all of them.

Usage:
    from app.ai.llm_client import acompletion

    # Non-streaming
    result = await acompletion("openai/gpt-4o", messages=[...])
    text = result["choices"][0]["message"]["content"]

    # Streaming
    async for chunk in await acompletion("openai/gpt-4o", messages=[...], stream=True):
        delta = chunk["choices"][0]["delta"]
"""

from __future__ import annotations

import json
import os
from typing import Any, AsyncGenerator

import httpx


# ---------------------------------------------------------------------------
# Module-level async client (lazy singleton, loop-aware)
# ---------------------------------------------------------------------------
_client: httpx.AsyncClient | None = None
_client_loop_id: int | None = None


def _get_client() -> httpx.AsyncClient:
    """Return a shared AsyncClient bound to the current event loop.

    If the event loop has changed (e.g. between pytest tests, or after
    a loop restart), the old client is discarded and a new one is created.
    This avoids 'Event loop is closed' errors from stale connections.
    """
    global _client, _client_loop_id
    import asyncio

    try:
        loop = asyncio.get_running_loop()
        current_loop_id = id(loop)
    except RuntimeError:
        current_loop_id = None

    if _client is not None and _client_loop_id != current_loop_id:
        # Loop changed — discard the old client (can't await aclose here
        # because the old loop may be gone; httpx handles GC gracefully)
        _client = None
        _client_loop_id = None

    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=5),
        )
        _client_loop_id = current_loop_id
    return _client


async def close_client() -> None:
    """Shutdown the module-level client. Call on app shutdown."""
    global _client, _client_loop_id
    if _client is not None:
        await _client.aclose()
        _client = None
        _client_loop_id = None


# ---------------------------------------------------------------------------
# Provider routing
# ---------------------------------------------------------------------------
# Maps provider prefix -> (base_url, env_var_for_api_key)
# The model string format is "provider/model-name".

PROVIDER_TABLE: dict[str, tuple[str, str | None]] = {
    "openai": ("https://api.openai.com/v1", "OPENAI_API_KEY"),
    "openrouter": ("https://openrouter.ai/api/v1", "OPENROUTER_API_KEY"),
    "anthropic": ("https://api.anthropic.com/v1", "ANTHROPIC_API_KEY"),
    "gemini": (
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "GEMINI_API_KEY",
    ),
    "ollama": ("http://localhost:11434/v1", None),
    "lm_studio": ("http://localhost:1234/v1", None),
}


def _parse_model_string(model: str) -> tuple[str, str | None, str]:
    """Parse 'provider/model-name' -> (base_url, api_key, model_name).

    Examples:
        'openai/gpt-4o'                  -> ('.../v1', key, 'gpt-4o')
        'openrouter/anthropic/claude-3.5' -> ('.../v1', key, 'anthropic/claude-3.5')
        'gemini/gemini-2.5-flash'         -> ('.../openai', key, 'gemini-2.5-flash')
        'ollama/llama3'                   -> ('.../v1', None, 'llama3')
    """
    parts = model.split("/", 1)
    if len(parts) < 2:
        # No provider prefix — assume openai
        return (
            PROVIDER_TABLE["openai"][0],
            os.environ.get("OPENAI_API_KEY"),
            model,
        )

    provider = parts[0].lower()
    model_name = parts[1]

    if provider in PROVIDER_TABLE:
        base_url, env_var = PROVIDER_TABLE[provider]

        # Local providers: read custom URL from settings env vars
        if provider == "lm_studio":
            custom = os.environ.get("LM_STUDIO_URL")
            if custom:
                base_url = custom.rstrip("/")
        elif provider == "ollama":
            custom = os.environ.get("OLLAMA_URL")
            if custom:
                base_url = custom.rstrip("/") + "/v1"

        api_key = os.environ.get(env_var) if env_var else None
        return base_url, api_key, model_name

    # Unknown provider — treat as openai-compatible with OPENAI_API_KEY
    return (
        PROVIDER_TABLE["openai"][0],
        os.environ.get("OPENAI_API_KEY"),
        model,
    )


# ---------------------------------------------------------------------------
# Exceptions (drop-in replacements for litellm.exceptions)
# ---------------------------------------------------------------------------


class LLMError(Exception):
    """Base class for LLM errors."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class AuthenticationError(LLMError):
    pass


class RateLimitError(LLMError):
    pass


class APIConnectionError(LLMError):
    pass


def _raise_for_status(resp: httpx.Response) -> None:
    """Map HTTP status codes to typed exceptions."""
    if resp.is_success:
        return
    status = resp.status_code
    try:
        body = resp.json()
        detail = body.get("error", {}).get("message", resp.text)
    except Exception:
        detail = resp.text

    if status == 401:
        raise AuthenticationError(f"Invalid API key: {detail}", status_code=401)
    elif status == 429:
        raise RateLimitError(f"Rate limit exceeded: {detail}", status_code=429)
    elif status >= 500:
        raise LLMError(f"Server error ({status}): {detail}", status_code=status)
    else:
        raise LLMError(f"API error ({status}): {detail}", status_code=status)


# ---------------------------------------------------------------------------
# Core: acompletion
# ---------------------------------------------------------------------------


async def acompletion(
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.0,
    max_tokens: int | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | None = None,
    stream: bool = False,
    **kwargs: Any,
) -> dict[str, Any] | AsyncGenerator[dict[str, Any], None]:
    """Async chat completion — drop-in replacement for litellm.acompletion().

    Returns:
        If stream=False: dict matching OpenAI ChatCompletion response.
        If stream=True: AsyncGenerator yielding SSE chunk dicts.
    """
    base_url, api_key, model_name = _parse_model_string(model)
    client = _get_client()

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload: dict[str, Any] = {
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    if tools:
        payload["tools"] = tools
    if tool_choice is not None:
        payload["tool_choice"] = tool_choice
    if stream:
        payload["stream"] = True

    url = f"{base_url}/chat/completions"

    if not stream:
        try:
            resp = await client.post(url, headers=headers, json=payload)
        except httpx.ConnectError as e:
            raise APIConnectionError(f"Could not connect to {base_url}: {e}")
        except httpx.TimeoutException as e:
            raise APIConnectionError(f"Request timed out: {e}")
        _raise_for_status(resp)
        return resp.json()

    # Streaming: return an async generator that yields parsed SSE chunks
    return _stream_completion(client, url, headers, payload)


async def _stream_completion(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
) -> AsyncGenerator[dict[str, Any], None]:
    """Stream SSE chunks from /chat/completions.

    Implements SSE parsing inline (no httpx-sse dependency).
    The OpenAI SSE format is simple: each event is `data: <json>\n\n`
    with a final `data: [DONE]\n\n`.
    """
    try:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            _raise_for_status(resp)
            buffer = ""
            async for raw_bytes in resp.aiter_bytes():
                buffer += raw_bytes.decode("utf-8", errors="replace")
                # Process complete SSE lines
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith("data: "):
                        data_str = line[6:]
                        if data_str.strip() == "[DONE]":
                            return
                        try:
                            yield json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
    except httpx.ConnectError as e:
        raise APIConnectionError(f"Could not connect: {e}")
    except httpx.TimeoutException as e:
        raise APIConnectionError(f"Stream timed out: {e}")
