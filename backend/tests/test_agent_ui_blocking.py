"""Tests for agent UI blocking fixes.

Root cause: When the agent is streaming (SSE), the user can't run queries
because:
1. Agent tool calls hold _db_lock, blocking user queries
2. Agent query_result events overwrite user's editor/grid (frontend issue)
3. No way to cancel a running agent from the UI

Fixes:
1. Use a short-lived lock per query instead of holding across tool calls
2. Frontend: don't overwrite editor during agent streaming (frontend fix)
3. Add cancellation support to agent streaming
"""

import asyncio
from pathlib import Path

import pytest

from app import db, workspace


@pytest.fixture(autouse=True)
def setup_workspace(tmp_workspace: Path):
    """Configure workspace for every test."""
    db.reset_db_lock()  # Ensure lock is bound to current event loop
    workspace.set_workspace(str(tmp_workspace))
    yield
    db.workspace_root = None
    workspace.schema_cache.clear()
    db.reset_db_lock()


@pytest.mark.asyncio
async def test_user_query_completes_during_agent_tool_call(tmp_workspace):
    """User query should not be blocked for more than a few ms
    even when agent tools are executing."""
    from app.ai.tools import execute_query

    # Start both concurrently
    async def agent_query():
        return await execute_query.ainvoke(
            {"sql": f"SELECT * FROM '{tmp_workspace}/large.csv' LIMIT 100"}
        )

    async def user_query():
        return await db.async_execute("SELECT 42 AS answer")

    # Both must finish within 5s
    results = await asyncio.wait_for(
        asyncio.gather(agent_query(), user_query()),
        timeout=5.0,
    )
    assert "answer" in str(results[1]["columns"])
    assert results[1]["rows"][0][0] == 42


@pytest.mark.asyncio
async def test_multiple_concurrent_queries_serialize_safely(tmp_workspace):
    """Multiple queries should serialize through the lock without deadlock."""
    tasks = [
        db.async_execute(f"SELECT {i} AS val")
        for i in range(5)
    ]
    results = await asyncio.wait_for(
        asyncio.gather(*tasks),
        timeout=5.0,
    )
    values = sorted(r["rows"][0][0] for r in results)
    assert values == [0, 1, 2, 3, 4]


@pytest.mark.asyncio
async def test_agent_stream_response_yields_done(tmp_workspace):
    """Agent stream should always yield a 'done' event at the end,
    even for simple questions, so frontend knows when to stop."""
    from unittest.mock import patch, MagicMock, AsyncMock
    from app.ai.agent import stream_agent_response

    # Mock the agent to return a simple response without real LLM call
    mock_agent = MagicMock()

    async def mock_astream(*args, **kwargs):
        # Simulate a simple model response (no tool calls)
        from langchain_core.messages import AIMessage
        yield {"model": {"messages": [AIMessage(content="Here are your files.")]}}

    mock_agent.astream = mock_astream

    with patch("app.ai.agent.build_agent", return_value=mock_agent):
        events = []
        async for event in stream_agent_response(
            message="what data is available?",
            chat_history=[],
            active_files=["sample.csv"],
        ):
            events.append(event)

    # Must have at least a token event and a done event
    types = [e["type"] for e in events]
    assert "token" in types
    assert "done" in types
    # done must be last
    assert types[-1] == "done"
