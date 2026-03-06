"""Chat thread persistence tests."""

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.routers.chats import CHATS_DIR, generate_slug_fallback


@pytest.fixture(autouse=True)
def clean_chats():
    """Clean chats directory before/after each test."""
    if CHATS_DIR.exists():
        shutil.rmtree(CHATS_DIR)
    yield
    if CHATS_DIR.exists():
        shutil.rmtree(CHATS_DIR)


@pytest.mark.asyncio
async def test_slug_generation_fallback():
    """If no API key, slug falls back to chat-{timestamp} format."""
    slug = generate_slug_fallback()
    assert slug.startswith("chat-")
    assert len(slug) > 5


@pytest.mark.asyncio
async def test_chat_save_and_load(client):
    """POST /api/chats/{slug}/save then GET /api/chats/{slug} returns messages."""
    slug = "test-thread-one"
    save_resp = await client.post(
        f"/api/chats/{slug}/save",
        json={
            "model": "openai/gpt-4o-mini",
            "messages": [
                {"role": "user", "content": "What is revenue?"},
                {"role": "assistant", "content": "Revenue is total income."},
            ],
        },
    )
    assert save_resp.status_code == 200

    get_resp = await client.get(f"/api/chats/{slug}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["slug"] == slug
    assert len(data["messages"]) == 2
    assert data["messages"][0]["role"] == "user"
    assert data["messages"][1]["role"] == "assistant"


@pytest.mark.asyncio
async def test_chat_list(client):
    """GET /api/chats returns list."""
    # Save two threads
    await client.post(
        "/api/chats/alpha-thread/save",
        json={
            "model": "openai/gpt-4o-mini",
            "messages": [{"role": "user", "content": "Hello alpha"}],
        },
    )
    await client.post(
        "/api/chats/beta-thread/save",
        json={
            "model": "openai/gpt-4o-mini",
            "messages": [{"role": "user", "content": "Hello beta"}],
        },
    )
    resp = await client.get("/api/chats")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 2
    slugs = [t["slug"] for t in data]
    assert "alpha-thread" in slugs
    assert "beta-thread" in slugs


@pytest.mark.asyncio
async def test_chat_delete(client):
    """DELETE /api/chats/{slug} removes thread."""
    slug = "to-delete"
    await client.post(
        f"/api/chats/{slug}/save",
        json={
            "model": "openai/gpt-4o-mini",
            "messages": [{"role": "user", "content": "Delete me"}],
        },
    )
    # Verify it exists
    get_resp = await client.get(f"/api/chats/{slug}")
    assert get_resp.status_code == 200

    # Delete
    del_resp = await client.request("DELETE", f"/api/chats/{slug}")
    assert del_resp.status_code == 200

    # Should be gone
    get_resp2 = await client.get(f"/api/chats/{slug}")
    assert get_resp2.status_code == 404


@pytest.mark.asyncio
async def test_chat_list_sorted(client):
    """Multiple threads, list is newest-first."""
    # Save thread with earlier timestamp
    await client.post(
        "/api/chats/old-thread/save",
        json={
            "created_at": "2025-01-01T00:00:00Z",
            "model": "openai/gpt-4o-mini",
            "messages": [{"role": "user", "content": "Old thread"}],
        },
    )
    # Save thread with later timestamp
    await client.post(
        "/api/chats/new-thread/save",
        json={
            "created_at": "2026-03-05T12:00:00Z",
            "model": "openai/gpt-4o-mini",
            "messages": [{"role": "user", "content": "New thread"}],
        },
    )
    resp = await client.get("/api/chats")
    data = resp.json()
    assert len(data) >= 2
    # Newest should be first
    assert data[0]["slug"] == "new-thread"
    assert data[1]["slug"] == "old-thread"
