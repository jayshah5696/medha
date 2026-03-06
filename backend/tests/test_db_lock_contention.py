"""Tests for DuckDB lock contention fix.

Problem: Agent tool calls hold _db_lock for their entire duration,
blocking user queries (Cmd+Enter) from executing until the agent finishes.

Fix: Agent tools should acquire/release the lock per-query (not hold it
across the entire agent run). The lock scope should be as narrow as
possible — just the DuckDB execute call.
"""

import asyncio
from pathlib import Path

import pytest

from app import db, workspace


@pytest.fixture(autouse=True)
def setup_workspace(tmp_workspace: Path):
    """Configure the workspace for every test in this module."""
    db.reset_db_lock()  # Ensure lock is bound to current event loop
    workspace.set_workspace(str(tmp_workspace))
    yield
    db.workspace_root = None
    workspace.schema_cache.clear()
    db.reset_db_lock()


@pytest.mark.asyncio
async def test_user_query_not_blocked_by_agent_tool(tmp_workspace):
    """User query via async_execute should not be blocked when agent
    tools are also running. Both should be able to acquire the lock
    in turn without long waits."""
    from app.ai.tools import execute_query

    # Run agent query and user query concurrently
    agent_task = asyncio.create_task(
        execute_query.ainvoke(
            {"sql": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 5"}
        )
    )
    # Small yield to let agent start
    await asyncio.sleep(0.01)

    user_task = asyncio.create_task(
        db.async_execute(f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 3")
    )

    # Both should complete within a reasonable time (not hang)
    agent_result, user_result = await asyncio.wait_for(
        asyncio.gather(agent_task, user_task),
        timeout=5.0,
    )

    assert "id" in agent_result
    assert user_result["row_count"] == 3


@pytest.mark.asyncio
async def test_concurrent_user_queries_dont_deadlock(tmp_workspace):
    """Multiple user queries should execute without deadlocking."""
    results = await asyncio.wait_for(
        asyncio.gather(
            db.async_execute(f"SELECT 1 AS a"),
            db.async_execute(f"SELECT 2 AS b"),
            db.async_execute(f"SELECT 3 AS c"),
        ),
        timeout=5.0,
    )
    assert results[0]["rows"] == [[1]]
    assert results[1]["rows"] == [[2]]
    assert results[2]["rows"] == [[3]]


@pytest.mark.asyncio
async def test_sample_data_releases_lock_quickly(tmp_workspace):
    """sample_data tool should release the lock so a user query can run."""
    from app.ai.tools import sample_data

    agent_task = asyncio.create_task(
        sample_data.ainvoke({"filename": "sample.csv", "n": 3})
    )
    await asyncio.sleep(0.01)

    user_task = asyncio.create_task(
        db.async_execute(f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 1")
    )

    agent_result, user_result = await asyncio.wait_for(
        asyncio.gather(agent_task, user_task),
        timeout=5.0,
    )

    assert "id" in agent_result
    assert user_result["row_count"] == 1


@pytest.mark.asyncio
async def test_get_schema_releases_lock_quickly(tmp_workspace):
    """get_schema tool should not hold _db_lock at all (it uses its own conn or
    is wrapped in to_thread which acquires/releases promptly)."""
    from app.ai.tools import get_schema

    agent_task = asyncio.create_task(
        get_schema.ainvoke({"filename": "sample.csv"})
    )
    await asyncio.sleep(0.01)

    user_task = asyncio.create_task(
        db.async_execute(f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 1")
    )

    agent_result, user_result = await asyncio.wait_for(
        asyncio.gather(agent_task, user_task),
        timeout=5.0,
    )

    assert "Schema for sample.csv" in agent_result
    assert user_result["row_count"] == 1
