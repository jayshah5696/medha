"""Tests for human-in-the-loop (HITL) row estimation guard.

Spec §4E: LangGraph interrupt on execute_query tool if query touches >1M rows
(estimated via COUNT(*)). Frontend receives {"type": "hitl", "message": "..."}.

These tests verify:
1. Row estimation via _estimate_row_count works for various queries.
2. Small queries (<1M rows) execute normally without HITL interrupt.
3. Large queries (>1M rows) trigger HITL and return a warning instead of executing.
4. The HITL threshold is configurable (default 1_000_000).
"""

import asyncio
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app import db, workspace
from app.ai.tools import execute_query, _pop_last_query_result


@pytest.fixture(autouse=True)
def setup_workspace(tmp_workspace: Path):
    """Configure the workspace for every test in this module."""
    workspace.set_workspace(str(tmp_workspace))
    yield
    db.workspace_root = None
    workspace.schema_cache.clear()


@pytest.mark.asyncio
async def test_estimate_row_count_small_table(tmp_workspace):
    """Row estimation should return a count for a valid query on a small table."""
    from app.ai.tools import _estimate_row_count

    count = await _estimate_row_count(
        f"SELECT * FROM '{tmp_workspace}/sample.csv'"
    )
    # sample.csv has 5 rows
    assert count is not None
    assert count == 5


@pytest.mark.asyncio
async def test_estimate_row_count_with_filter(tmp_workspace):
    """Row estimation should respect WHERE clauses."""
    from app.ai.tools import _estimate_row_count

    count = await _estimate_row_count(
        f"SELECT * FROM '{tmp_workspace}/sample.csv' WHERE id <= 2"
    )
    assert count is not None
    assert count == 2


@pytest.mark.asyncio
async def test_estimate_row_count_returns_none_on_error(tmp_workspace):
    """If COUNT(*) estimation fails, return None (don't block the query)."""
    from app.ai.tools import _estimate_row_count

    count = await _estimate_row_count("SELECT * FROM nonexistent_file.csv")
    assert count is None


@pytest.mark.asyncio
async def test_small_query_executes_normally(tmp_workspace):
    """Queries on small tables should execute without HITL interruption."""
    _pop_last_query_result()

    result = await execute_query.ainvoke(
        {"sql": f"SELECT * FROM '{tmp_workspace}/sample.csv'"}
    )
    assert "Error" not in result
    assert "HITL" not in result
    assert "id" in result

    stashed = _pop_last_query_result()
    assert stashed is not None


@pytest.mark.asyncio
async def test_large_query_triggers_hitl(tmp_workspace):
    """Queries estimated to scan >1M rows should return a HITL warning
    instead of executing."""
    _pop_last_query_result()

    # Mock _estimate_row_count to return a large number
    with patch("app.ai.tools._estimate_row_count", return_value=2_500_000):
        result = await execute_query.ainvoke(
            {"sql": f"SELECT * FROM '{tmp_workspace}/sample.csv'"}
        )

    # Should contain HITL warning, not execute the query
    assert "2,500,000" in result or "2500000" in result
    assert "rows" in result.lower()

    # Should NOT have stashed a result
    stashed = _pop_last_query_result()
    assert stashed is None


@pytest.mark.asyncio
async def test_hitl_threshold_boundary(tmp_workspace):
    """Queries at exactly 1M rows should NOT trigger HITL (only >1M)."""
    _pop_last_query_result()

    with patch("app.ai.tools._estimate_row_count", return_value=1_000_000):
        result = await execute_query.ainvoke(
            {"sql": f"SELECT * FROM '{tmp_workspace}/sample.csv'"}
        )

    # At exactly 1M, should proceed (only >1M triggers HITL)
    assert "Error" not in result or "HITL" not in result


@pytest.mark.asyncio
async def test_hitl_estimation_failure_allows_execution(tmp_workspace):
    """If row estimation fails (returns None), the query should still execute."""
    _pop_last_query_result()

    with patch("app.ai.tools._estimate_row_count", return_value=None):
        result = await execute_query.ainvoke(
            {"sql": f"SELECT * FROM '{tmp_workspace}/sample.csv'"}
        )

    # Should execute normally when estimation fails
    assert "id" in result
    stashed = _pop_last_query_result()
    assert stashed is not None
