"""Phase 7: Bug fix tests.

BUG-1: Agent should auto-populate active_files from workspace when empty.
BUG-2: Inline slug generation should use LLM before falling back.
BUG-3: History saves individual statements, agent queries recorded, deduplication.
BUG-4: Sidebar history auto-refresh (frontend only, covered separately).
"""

import hashlib
import shutil
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import db, workspace
from app.routers.history import (
    HISTORY_DIR,
    save_history_entry,
    _list_history_entries,
    _compute_sql_hash,
    _is_duplicate,
)


# ── BUG-1: auto-populate active_files ──────────────────────────────────

class TestBug1AutoPopulateActiveFiles:
    """When active_files is empty but workspace is configured, the agent
    should auto-inject all workspace files into active_files."""

    @pytest.mark.asyncio
    async def test_stream_agent_augments_files_when_empty(self, tmp_workspace):
        """stream_agent_response should inject workspace files if active_files empty."""
        workspace.set_workspace(str(tmp_workspace))
        try:
            from app.ai.agent import _resolve_active_files
            resolved = _resolve_active_files([])
            # Should contain files from workspace
            assert len(resolved) > 0
            assert "sample.csv" in resolved
            assert "sample.parquet" in resolved
        finally:
            db.workspace_root = None
            workspace.schema_cache.clear()

    @pytest.mark.asyncio
    async def test_resolve_active_files_preserves_explicit(self, tmp_workspace):
        """If active_files is non-empty, _resolve_active_files returns it unchanged."""
        workspace.set_workspace(str(tmp_workspace))
        try:
            from app.ai.agent import _resolve_active_files
            explicit = ["sample.csv"]
            resolved = _resolve_active_files(explicit)
            assert resolved == ["sample.csv"]
        finally:
            db.workspace_root = None
            workspace.schema_cache.clear()

    @pytest.mark.asyncio
    async def test_resolve_active_files_empty_no_workspace(self):
        """If no workspace is configured and active_files empty, return empty."""
        db.workspace_root = None
        from app.ai.agent import _resolve_active_files
        resolved = _resolve_active_files([])
        assert resolved == []


# ── BUG-3: Statement-level history + deduplication ─────────────────────

@pytest.fixture(autouse=True)
def clean_history():
    """Clean history directory before/after each test."""
    if HISTORY_DIR.exists():
        shutil.rmtree(HISTORY_DIR)
    yield
    if HISTORY_DIR.exists():
        shutil.rmtree(HISTORY_DIR)


class TestBug3StatementHistory:
    """History should save individual statements, not entire editor buffers."""

    def test_save_history_entry_with_source_user(self):
        """save_history_entry should accept source='user' and write it to header."""
        save_history_entry(
            sql="SELECT 1;",
            duration_ms=5.0,
            row_count=1,
            truncated=False,
            workspace_path="/tmp/test",
            source="user",
        )
        sql_files = list(HISTORY_DIR.rglob("*.sql"))
        assert len(sql_files) == 1
        content = sql_files[0].read_text()
        assert "-- source: user" in content

    def test_save_history_entry_with_source_agent(self):
        """save_history_entry should accept source='agent' and thread_slug."""
        save_history_entry(
            sql="SELECT * FROM train LIMIT 10;",
            duration_ms=12.0,
            row_count=10,
            truncated=False,
            workspace_path="/tmp/test",
            source="agent",
            thread_slug="weekly-sales-analysis",
        )
        sql_files = list(HISTORY_DIR.rglob("*.sql"))
        assert len(sql_files) == 1
        content = sql_files[0].read_text()
        assert "-- source: agent" in content
        assert "-- thread: weekly-sales-analysis" in content

    def test_save_history_entry_default_source_is_user(self):
        """Default source should be 'user' for backward compat."""
        save_history_entry(
            sql="SELECT 2;",
            duration_ms=1.0,
            row_count=1,
            truncated=False,
        )
        sql_files = list(HISTORY_DIR.rglob("*.sql"))
        assert len(sql_files) == 1
        content = sql_files[0].read_text()
        assert "-- source: user" in content


class TestBug3Deduplication:
    """Same SQL run within short window should be deduplicated."""

    def test_compute_sql_hash(self):
        """SQL hash should normalize whitespace."""
        h1 = _compute_sql_hash("SELECT 1;")
        h2 = _compute_sql_hash("  SELECT   1 ;  ")
        assert h1 == h2

    def test_is_duplicate_returns_true_for_recent(self):
        """Running same SQL within dedup window returns True."""
        save_history_entry(
            sql="SELECT * FROM foo;",
            duration_ms=1.0,
            row_count=5,
            truncated=False,
        )
        assert _is_duplicate("SELECT * FROM foo;", window_seconds=10) is True

    def test_is_duplicate_returns_false_for_different_sql(self):
        """Different SQL is not a duplicate."""
        save_history_entry(
            sql="SELECT * FROM foo;",
            duration_ms=1.0,
            row_count=5,
            truncated=False,
        )
        assert _is_duplicate("SELECT * FROM bar;", window_seconds=10) is False

    def test_dedup_skips_save(self):
        """save_history_entry with dedup=True should skip duplicate."""
        save_history_entry(
            sql="SELECT dedup_test;",
            duration_ms=1.0,
            row_count=1,
            truncated=False,
        )
        # Try to save same SQL again with dedup
        save_history_entry(
            sql="SELECT dedup_test;",
            duration_ms=2.0,
            row_count=1,
            truncated=False,
            dedup=True,
        )
        sql_files = list(HISTORY_DIR.rglob("*.sql"))
        assert len(sql_files) == 1  # Only one file, not two


class TestBug3HistoryListWithSource:
    """History list endpoint should include source field."""

    def test_list_entries_includes_source(self):
        """Listed entries should include 'source' field."""
        save_history_entry(
            sql="SELECT agent_query;",
            duration_ms=3.0,
            row_count=1,
            truncated=False,
            source="agent",
            thread_slug="test-thread",
        )
        entries = _list_history_entries()
        assert len(entries) == 1
        assert entries[0]["source"] == "agent"
        assert entries[0]["thread_slug"] == "test-thread"

    def test_list_entries_user_source(self):
        """User queries have source='user'."""
        save_history_entry(
            sql="SELECT user_query;",
            duration_ms=3.0,
            row_count=1,
            truncated=False,
            source="user",
        )
        entries = _list_history_entries()
        assert len(entries) == 1
        assert entries[0]["source"] == "user"
        assert entries[0]["thread_slug"] == ""


class TestBug3AgentQuerySavedToHistory:
    """When the agent executes a query, it should be saved to history."""

    @pytest.mark.asyncio
    async def test_execute_query_tool_saves_history(self, tmp_workspace):
        """execute_query tool should call save_history_entry with source='agent'."""
        workspace.set_workspace(str(tmp_workspace))
        try:
            from app.ai.tools import execute_query

            result = await execute_query.ainvoke(
                {"sql": f"SELECT id FROM '{tmp_workspace}/sample.csv' LIMIT 2"}
            )
            # Should have saved to history
            sql_files = list(HISTORY_DIR.rglob("*.sql"))
            assert len(sql_files) >= 1
            content = sql_files[0].read_text()
            assert "-- source: agent" in content
        finally:
            db.workspace_root = None
            workspace.schema_cache.clear()


# ── BUG-2: Inline slug generation ─────────────────────────────────────

class TestBug2InlineSlugGeneration:
    """Slug should be generated inline via LLM with timeout before SSE event."""

    @pytest.mark.asyncio
    async def test_generate_slug_inline_success(self):
        """generate_slug_from_message should succeed inline with a short call."""
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "data-exploration"

        with patch("app.routers.chats.litellm") as mock_litellm, \
             patch("app.routers.chats._get_slug_model", return_value="openai/gpt-4o-mini"):
            mock_litellm.acompletion = AsyncMock(return_value=mock_response)
            from app.routers.chats import generate_slug_from_message
            slug = await generate_slug_from_message("explore my data")
            assert slug == "data-exploration"
            assert not slug.startswith("chat-")

    @pytest.mark.asyncio
    async def test_slug_inline_timeout_falls_back(self):
        """If LLM takes too long, slug falls back to timestamp."""
        import asyncio

        async def slow_response(*args, **kwargs):
            await asyncio.sleep(5)

        with patch("app.routers.chats.litellm") as mock_litellm, \
             patch("app.routers.chats._get_slug_model", return_value="openai/gpt-4o-mini"):
            mock_litellm.acompletion = slow_response
            from app.routers.chats import generate_slug_from_message_with_timeout
            slug = await generate_slug_from_message_with_timeout("anything", timeout=0.1)
            assert slug.startswith("chat-")
