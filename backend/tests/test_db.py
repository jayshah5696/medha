"""Database query endpoint tests."""

from pathlib import Path

import pytest
import httpx

from app import db, workspace
from app.main import app


@pytest.mark.asyncio
async def test_auto_limit_injected(configured_client, tmp_workspace):
    """Query large.csv with no LIMIT: row_count should be capped at 10000."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/large.csv'"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["row_count"] <= 10000


@pytest.mark.asyncio
async def test_auto_limit_respects_existing(configured_client, tmp_workspace):
    """Query with explicit LIMIT 5 returns exactly 5 rows."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 5"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["row_count"] == 5


@pytest.mark.asyncio
async def test_path_traversal_rejected(configured_client):
    """Query containing '../' should be rejected with 400."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": "SELECT * FROM '../etc/passwd'"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_query_returns_correct_columns(configured_client, tmp_workspace):
    """Query sample.csv and verify column names."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv'"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["columns"] == ["id", "name", "score"]


@pytest.mark.asyncio
async def test_query_duration_present(configured_client, tmp_workspace):
    """Response must include duration_ms > 0."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv'"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "duration_ms" in data
    assert data["duration_ms"] > 0


@pytest.mark.asyncio
async def test_truncated_flag_true(configured_client, tmp_workspace):
    """Query large.csv (10001 rows) with auto-limit: truncated should be True."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/large.csv'"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["truncated"] is True


@pytest.mark.asyncio
async def test_truncated_flag_false(configured_client, tmp_workspace):
    """Query sample.csv with LIMIT 5: truncated should be False."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 5"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["truncated"] is False


@pytest.mark.asyncio
async def test_cancel_nonexistent_query(configured_client):
    """DELETE /api/db/query/fake-id should return 404."""
    resp = await configured_client.request(
        "DELETE",
        "/api/db/query/fake-id",
    )
    assert resp.status_code == 404


# --- SQL safety tests ---


@pytest.mark.asyncio
async def test_copy_blocked(configured_client, tmp_workspace):
    """Query containing COPY should be rejected with 400."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"COPY (SELECT 1) TO '{tmp_workspace}/out.csv'"},
    )
    assert resp.status_code == 400
    assert "COPY" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_install_blocked(configured_client):
    """Query containing INSTALL should be rejected with 400."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": "INSTALL httpfs"},
    )
    assert resp.status_code == 400
    assert "INSTALL" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_attach_blocked(configured_client):
    """Query containing ATTACH should be rejected with 400."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": "ATTACH '/tmp/evil.db' AS evil"},
    )
    assert resp.status_code == 400
    assert "ATTACH" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_load_blocked(configured_client):
    """Query containing LOAD should be rejected with 400."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": "LOAD httpfs"},
    )
    assert resp.status_code == 400
    assert "LOAD" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_export_blocked(configured_client):
    """Query containing EXPORT should be rejected with 400."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": "EXPORT DATABASE '/tmp/dump'"},
    )
    assert resp.status_code == 400
    assert "EXPORT" in resp.json()["detail"]


# --- FILE_SEARCH_PATH: relative paths resolve against workspace ---


@pytest.mark.asyncio
async def test_relative_path_resolves_to_workspace(configured_client, tmp_workspace):
    """Query with bare filename 'sample.csv' should resolve against workspace_root."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": "SELECT * FROM 'sample.csv' LIMIT 3"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["columns"] == ["id", "name", "score"]
    assert data["row_count"] == 3


@pytest.mark.asyncio
async def test_select_literal_works_with_workspace(configured_client):
    """SELECT 1 (no file reference) should work when workspace is configured."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": "SELECT 1 AS val"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["columns"] == ["val"]
    assert data["rows"] == [[1]]


@pytest.mark.asyncio
async def test_relative_path_in_agent_tool(tmp_workspace):
    """execute_query tool with bare filename should also resolve via FILE_SEARCH_PATH."""
    from app import workspace as ws
    from app.ai.tools import execute_query as eq_tool
    ws.set_workspace(str(tmp_workspace))
    try:
        result = await eq_tool.ainvoke({"sql": "SELECT * FROM 'sample.csv' LIMIT 2"})
        assert "id" in result
        assert "name" in result
        assert "Error" not in result
    finally:
        db.workspace_root = None
        ws.schema_cache.clear()


@pytest.mark.asyncio
async def test_query_blocked_without_workspace():
    """POST /api/db/query without configuring a workspace should return 400."""
    # Use a raw client (no configured_client fixture) so workspace_root is None
    old_root = db.workspace_root
    db.workspace_root = None
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as raw:
            resp = await raw.post(
                "/api/db/query",
                json={"query": "SELECT 1"},
            )
            assert resp.status_code == 400
            assert "No workspace configured" in resp.json()["detail"]
    finally:
        db.workspace_root = old_root


# --- Phase 2: Server-side pagination tests ---


@pytest.mark.asyncio
async def test_pagination_default_returns_first_page(configured_client, tmp_workspace):
    """Query with offset/limit returns only the requested page of rows."""
    resp = await configured_client.post(
        "/api/db/query",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/large.csv'",
            "limit": 100,
            "offset": 0,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["row_count"] == 100
    assert data["has_more"] is True
    assert data["offset"] == 0
    assert data["total_row_count"] > 100


@pytest.mark.asyncio
async def test_pagination_second_page(configured_client, tmp_workspace):
    """Requesting offset=100, limit=100 returns rows 101-200."""
    resp = await configured_client.post(
        "/api/db/query",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/large.csv'",
            "limit": 100,
            "offset": 100,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["row_count"] == 100
    assert data["offset"] == 100
    # The IDs should start at 101 (second page of a sequential dataset)
    assert data["rows"][0][0] == 101


@pytest.mark.asyncio
async def test_pagination_last_page_has_more_false(configured_client, tmp_workspace):
    """When offset + limit >= total, has_more should be False."""
    # sample.csv has 5 rows; request all of them
    resp = await configured_client.post(
        "/api/db/query",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/sample.csv'",
            "limit": 100,
            "offset": 0,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["row_count"] == 5
    assert data["has_more"] is False
    assert data["total_row_count"] == 5


@pytest.mark.asyncio
async def test_pagination_total_row_count_consistent(configured_client, tmp_workspace):
    """total_row_count is the same across pages for the same query."""
    resp1 = await configured_client.post(
        "/api/db/query",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/large.csv'",
            "limit": 50,
            "offset": 0,
        },
    )
    resp2 = await configured_client.post(
        "/api/db/query",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/large.csv'",
            "limit": 50,
            "offset": 50,
        },
    )
    assert resp1.json()["total_row_count"] == resp2.json()["total_row_count"]


@pytest.mark.asyncio
async def test_pagination_columns_present_on_all_pages(configured_client, tmp_workspace):
    """Column names are returned on every page, not just the first."""
    resp = await configured_client.post(
        "/api/db/query",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/sample.csv'",
            "limit": 2,
            "offset": 2,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["columns"] == ["id", "name", "score"]


@pytest.mark.asyncio
async def test_pagination_without_params_uses_defaults(configured_client, tmp_workspace):
    """Omitting offset/limit uses defaults (backward compatible)."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv'"},
    )
    assert resp.status_code == 200
    data = resp.json()
    # Should still work and return all 5 rows (default page size >= 5)
    assert data["row_count"] == 5
    # New fields should still be present
    assert "total_row_count" in data
    assert "has_more" in data
    assert "offset" in data


@pytest.mark.asyncio
async def test_pagination_respects_user_limit(configured_client, tmp_workspace):
    """User's SQL LIMIT should be respected — pagination applies on top."""
    resp = await configured_client.post(
        "/api/db/query",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/large.csv' LIMIT 50",
            "limit": 20,
            "offset": 0,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["row_count"] == 20
    assert data["total_row_count"] == 50
    assert data["has_more"] is True
