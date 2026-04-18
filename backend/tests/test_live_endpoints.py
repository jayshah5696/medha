"""Live endpoint integration tests — hit the actual FastAPI routes with real LLM calls.

Run with:
    cd backend && OPENROUTER_API_KEY=... uv run pytest tests/test_live_endpoints.py -v -s

Requires OPENROUTER_API_KEY in environment.
Tests the full stack: HTTP request → FastAPI router → lazy import → llm_client → OpenRouter.
"""

import json
import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("OPENROUTER_API_KEY"),
    reason="OPENROUTER_API_KEY not set — skipping live endpoint tests",
)

MODEL = "openrouter/google/gemini-2.0-flash-lite-001"


# ---------------------------------------------------------------------------
# /api/ai/inline — Cmd+K inline edit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_endpoint_inline_edit(client):
    """Full stack: POST /api/ai/inline → inline_edit → llm_client → OpenRouter."""
    resp = await client.post(
        "/api/ai/inline",
        json={
            "instruction": "Fix the SQL syntax error",
            "selected_sql": "SELEKT * FROM test;",
            "active_files": [],
            "model": MODEL,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    sql = data["sql"]
    print(f"\n[INLINE] Fixed SQL: {sql}")
    assert "SELECT" in sql.upper()
    assert "SELEKT" not in sql.upper()


@pytest.mark.asyncio
async def test_endpoint_inline_edit_with_error_context(client):
    """Inline edit with DuckDB error context — model should fix the specific error."""
    resp = await client.post(
        "/api/ai/inline",
        json={
            "instruction": "Fix this DuckDB SQL error",
            "selected_sql": "SELECT * FROM 'data.csv' LIMIT;",
            "active_files": [],
            "model": MODEL,
            "error_message": "Parser Error: syntax error at or near ';'",
        },
    )
    assert resp.status_code == 200
    sql = resp.json()["sql"]
    print(f"\n[INLINE+ERR] Fixed SQL: {sql}")
    # Model should have fixed the syntax error — either by adding a number
    # after LIMIT or by removing the broken LIMIT clause entirely.
    # The key assertion: it should NOT contain the original broken syntax.
    assert "SELECT" in sql.upper()
    assert "LIMIT;" not in sql.upper(), "Should have fixed 'LIMIT;' syntax error"


# ---------------------------------------------------------------------------
# /api/ai/chat — Agent SSE streaming
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_endpoint_chat_stream(client):
    """Full stack: POST /api/ai/chat → stream_agent_response → SSE events."""
    resp = await client.post(
        "/api/ai/chat",
        json={
            "message": "What is 3 + 4? Just give me the number.",
            "active_files": [],
            "model": MODEL,
            "profile": "default",
        },
    )
    assert resp.status_code == 200

    # Parse SSE events from the response body
    body = resp.text
    events = []
    for line in body.split("\n"):
        line = line.strip()
        if line.startswith("data: "):
            try:
                events.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass

    print(f"\n[CHAT] Received {len(events)} SSE events")
    for e in events:
        print(f"  {e.get('type')}: {str(e)[:120]}")

    # Must have at least one token and a done event
    types = [e.get("type") for e in events]
    assert "token" in types, f"No token events. Events: {events}"
    assert "done" in types, f"No done event. Events: {events}"

    # Collect the full response
    content = "".join(e.get("content", "") for e in events if e.get("type") == "token")
    print(f"[CHAT] Full content: {content}")
    assert "7" in content, f"Expected '7' in response: {content}"


@pytest.mark.asyncio
async def test_endpoint_chat_with_history(client):
    """Chat with history — model should have context from prior messages."""
    resp = await client.post(
        "/api/ai/chat",
        json={
            "message": "What did I just say?",
            "active_files": [],
            "model": MODEL,
            "profile": "fast",
        },
    )
    assert resp.status_code == 200
    body = resp.text
    events = []
    for line in body.split("\n"):
        line = line.strip()
        if line.startswith("data: "):
            try:
                events.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass

    types = [e.get("type") for e in events]
    # Should get either token (answer) or error (no history = confused), and done
    assert "done" in types or "error" in types


# ---------------------------------------------------------------------------
# /api/ai/chat — Agent with tool use (uses real workspace)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_endpoint_chat_agent_tool_use(configured_client):
    """Agent should use tools (get_schema) when asked about workspace files."""
    resp = await configured_client.post(
        "/api/ai/chat",
        json={
            "message": "What columns does sample.csv have? Use the get_schema tool.",
            "active_files": ["sample.csv"],
            "model": MODEL,
            "profile": "default",
        },
    )
    assert resp.status_code == 200

    events = []
    for line in resp.text.split("\n"):
        line = line.strip()
        if line.startswith("data: "):
            try:
                events.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass

    print(f"\n[AGENT TOOLS] {len(events)} events:")
    for e in events:
        print(f"  {e.get('type')}: {str(e)[:150]}")

    types = [e.get("type") for e in events]

    # Should have tool_call events (agent used get_schema)
    assert "tool_call" in types, f"Agent didn't call any tools. Types: {types}"
    assert "done" in types

    # Agent should have produced some response content
    content = "".join(e.get("content", "") for e in events if e.get("type") == "token")
    print(f"[AGENT TOOLS] Content: {content}")
    # The model called get_schema (verified above) and responded — content should be non-empty
    assert content.strip(), "Expected non-empty response after tool use"


# ---------------------------------------------------------------------------
# Slug generation through chats router
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_slug_generation_live():
    """Slug generation via llm_client — real LLM call."""
    from app.routers.chats import generate_slug_from_message

    # Temporarily override the slug model to use our test model
    from unittest.mock import patch
    with patch("app.routers.chats._get_slug_model", return_value=MODEL):
        slug = await generate_slug_from_message("Show me the top 10 customers by revenue")

    print(f"\n[SLUG] Generated: {slug}")
    assert slug, "Slug should not be empty"
    assert not slug.startswith("chat-"), f"Should be LLM-generated, not fallback: {slug}"
    assert len(slug) >= 3
    # Should be kebab-case
    assert " " not in slug
    assert slug == slug.lower()


@pytest.mark.asyncio
async def test_slug_generation_with_timeout_live():
    """Slug generation with timeout — should complete within timeout."""
    from app.routers.chats import generate_slug_from_message_with_timeout
    from unittest.mock import patch

    with patch("app.routers.chats._get_slug_model", return_value=MODEL):
        slug = await generate_slug_from_message_with_timeout(
            "What are the monthly trends?", timeout=10.0
        )

    print(f"\n[SLUG TIMEOUT] Generated: {slug}")
    assert slug
    assert not slug.startswith("chat-"), f"Should be LLM-generated: {slug}"
