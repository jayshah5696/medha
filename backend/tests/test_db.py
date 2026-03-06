"""Database query endpoint tests."""

from pathlib import Path

import pytest

from app import db, workspace


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
