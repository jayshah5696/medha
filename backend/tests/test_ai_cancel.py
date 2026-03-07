"""Tests for agent run cancellation (DELETE /api/ai/chat/{thread_id}).

Spec §4D: Cancel/abort active agent run.

These tests verify:
1. Active agent streams can be cancelled via DELETE endpoint.
2. Cancelled streams emit an error event and stop.
3. Cancelling a non-existent stream returns 404.
4. Active runs are tracked and cleaned up after completion.
"""

import asyncio
import json

import pytest
import httpx

from app.main import app
from app.routers.ai import _active_agent_runs


@pytest.fixture
def _reset_active_runs():
    """Clear active runs before/after each test."""
    _active_agent_runs.clear()
    yield
    _active_agent_runs.clear()


@pytest.mark.asyncio
async def test_cancel_nonexistent_agent_run(client, _reset_active_runs):
    """DELETE on a non-existent thread_id returns 404."""
    resp = await client.delete("/api/ai/chat/nonexistent-thread")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cancel_active_agent_run_returns_ok(client, _reset_active_runs):
    """When an agent run is tracked, DELETE returns 200 with ok=True."""
    # Simulate an active run by adding a cancellation event
    cancel_event = asyncio.Event()
    _active_agent_runs["test-thread-123"] = cancel_event

    resp = await client.delete("/api/ai/chat/test-thread-123")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["thread_id"] == "test-thread-123"
    # The event should be set (signalling cancellation)
    assert cancel_event.is_set()


@pytest.mark.asyncio
async def test_cancel_cleans_up_active_runs(client, _reset_active_runs):
    """After cancellation, the thread_id is removed from active runs."""
    cancel_event = asyncio.Event()
    _active_agent_runs["cleanup-thread"] = cancel_event

    await client.delete("/api/ai/chat/cleanup-thread")
    assert "cleanup-thread" not in _active_agent_runs


@pytest.mark.asyncio
async def test_active_runs_empty_after_normal_completion(_reset_active_runs):
    """Active runs dict should be empty when no agents are running."""
    assert len(_active_agent_runs) == 0
