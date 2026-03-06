"""Integration tests for the AI agent.

These tests verify that:
1. The agent compiles successfully from YAML config (no real LLM call needed).
2. The streaming generator emits correctly-structured typed dicts.
3. Error paths emit proper {"type": "error"} events instead of raising.
4. Profile validation rejects path traversal attempts (SEC-2).

LLM calls are mocked via unittest.mock so the tests are fully offline.
"""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ai.agent import load_agent_config, stream_agent_response, _validate_profile, _agent_cache


# ---------------------------------------------------------------------------
# Agent compilation tests (no LLM calls at all)
# ---------------------------------------------------------------------------


def test_load_agent_config_default():
    """Default profile has required keys."""
    config = load_agent_config("default")
    assert "model" in config
    assert "temperature" in config
    assert "system_prompt" in config


def test_load_agent_config_fast():
    """Fast profile has reduced max_iterations."""
    config = load_agent_config("fast")
    assert config["max_iterations"] <= 5


def test_load_agent_config_deep():
    """Deep profile has elevated max_iterations."""
    config = load_agent_config("deep")
    assert config["max_iterations"] >= 10


def test_load_agent_config_missing_falls_back():
    """Unknown profile silently falls back to default."""
    config = load_agent_config("does-not-exist")
    assert config["name"] == "default"


def test_build_agent_returns_callable():
    """build_agent() compiles without errors and returns an agent-like object."""
    mock_compiled = MagicMock()
    mock_compiled.astream_events = MagicMock()
    with patch("app.ai.agent.create_agent", return_value=mock_compiled):
        _agent_cache.clear()
        from app.ai.agent import build_agent
        agent = build_agent(profile="default", model_override="test/model")
    assert agent is not None
    assert callable(getattr(agent, "astream_events", None))


def test_build_agent_caches():
    """Calling build_agent twice with same args returns the same object."""
    mock_compiled = MagicMock()
    mock_compiled.astream_events = MagicMock()
    with patch("app.ai.agent.create_agent", return_value=mock_compiled):
        _agent_cache.clear()
        from app.ai.agent import build_agent
        a1 = build_agent(profile="default", model_override="test/cached")
        a2 = build_agent(profile="default", model_override="test/cached")
    assert a1 is a2


def test_build_agent_model_override():
    """Different model override produces a different cache entry."""
    with patch("app.ai.agent.create_agent", side_effect=lambda *a, **kw: MagicMock()):
        _agent_cache.clear()
        from app.ai.agent import build_agent
        a1 = build_agent(profile="default", model_override="test/model-a")
        a2 = build_agent(profile="default", model_override="test/model-b")
    # Different objects because cache key differs
    assert a1 is not a2


# ---------------------------------------------------------------------------
# SEC-2: Profile validation
# ---------------------------------------------------------------------------


def test_validate_profile_rejects_traversal():
    """Path traversal attempts must be rejected."""
    with pytest.raises(ValueError):
        _validate_profile("../../etc/hostname")


def test_validate_profile_rejects_dots():
    """Dotted names are rejected."""
    with pytest.raises(ValueError):
        _validate_profile("some.profile")


def test_validate_profile_accepts_valid():
    """Normal profile names pass validation."""
    assert _validate_profile("default") == "default"
    assert _validate_profile("fast") == "fast"
    assert _validate_profile("my-custom-profile") == "my-custom-profile"


# ---------------------------------------------------------------------------
# Streaming tests (LLM mocked) — now yields dicts, not SSE strings
# ---------------------------------------------------------------------------


def _make_ai_msg(text: str):
    """Build a fake AIMessage with content."""
    mock_msg = MagicMock()
    mock_msg.content = text
    mock_msg.tool_calls = []
    return mock_msg


def _make_ai_msg_with_tool_call(tool_name: str):
    """Build a fake AIMessage that calls a tool."""
    mock_msg = MagicMock()
    mock_msg.content = ""
    mock_msg.tool_calls = [{"name": tool_name, "args": {}}]
    return mock_msg


def _make_tool_msg(tool_name: str):
    """Build a fake ToolMessage."""
    mock_msg = MagicMock()
    mock_msg.name = tool_name
    mock_msg.content = "tool result"
    return mock_msg


async def _fake_astream(chunks):
    """Return an async generator from a list of astream-style chunks."""
    for chunk in chunks:
        yield chunk


@pytest.mark.asyncio
async def test_stream_agent_response_emits_tokens():
    """Tokens from the LLM produce typed dict token chunks."""
    fake_chunks = [
        {"model": {"messages": [_make_ai_msg("SELECT * FROM data")]}},
    ]

    mock_agent = MagicMock()
    mock_agent.astream = MagicMock(
        return_value=_fake_astream(fake_chunks)
    )

    with patch("app.ai.agent.build_agent", return_value=mock_agent):
        chunks = []
        async for chunk in stream_agent_response(
            message="show all rows",
            chat_history=[],
        ):
            chunks.append(chunk)

    token_chunks = [c for c in chunks if c.get("type") == "token"]
    assert len(token_chunks) == 1
    assert "SELECT" in token_chunks[0]["content"]
    assert any(c.get("type") == "done" for c in chunks)


@pytest.mark.asyncio
async def test_stream_agent_response_emits_tool_events():
    """Tool start/end events are surfaced as typed dict tool_call chunks."""
    fake_chunks = [
        # Model decides to call a tool
        {"model": {"messages": [_make_ai_msg_with_tool_call("get_schema")]}},
        # Tool returns result
        {"tools": {"messages": [_make_tool_msg("get_schema")]}},
    ]

    mock_agent = MagicMock()
    mock_agent.astream = MagicMock(
        return_value=_fake_astream(fake_chunks)
    )

    with patch("app.ai.agent.build_agent", return_value=mock_agent):
        chunks = []
        async for chunk in stream_agent_response(
            message="describe the schema",
            chat_history=[],
        ):
            chunks.append(chunk)

    tool_chunks = [c for c in chunks if c.get("type") == "tool_call"]
    assert len(tool_chunks) == 2
    assert tool_chunks[0]["status"] == "start"
    assert tool_chunks[1]["status"] == "end"


@pytest.mark.asyncio
async def test_stream_agent_response_emits_done():
    """Generator always ends with a done event."""
    mock_agent = MagicMock()
    mock_agent.astream = MagicMock(
        return_value=_fake_astream([])
    )

    with patch("app.ai.agent.build_agent", return_value=mock_agent):
        chunks = []
        async for chunk in stream_agent_response("hello", chat_history=[]):
            chunks.append(chunk)

    assert any(c.get("type") == "done" for c in chunks)


@pytest.mark.asyncio
async def test_stream_agent_response_on_llm_error():
    """An exception from the agent yields an error dict, not a raise."""

    async def _boom(*args, **kwargs):
        raise RuntimeError("rate limit exceeded")
        yield  # make it a generator

    mock_agent = MagicMock()
    mock_agent.astream = MagicMock(side_effect=_boom)

    with patch("app.ai.agent.build_agent", return_value=mock_agent):
        chunks = []
        async for chunk in stream_agent_response("boom", chat_history=[]):
            chunks.append(chunk)

    error_chunks = [c for c in chunks if c.get("type") == "error"]
    assert len(error_chunks) >= 1
    assert "rate limit" in error_chunks[0]["message"]
