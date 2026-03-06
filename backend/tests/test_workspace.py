"""Workspace endpoint tests."""

from pathlib import Path

import pytest

from app import db, workspace


@pytest.mark.asyncio
async def test_files_empty_before_configure(client):
    """GET /api/workspace/files without configure returns empty list."""
    # Ensure no workspace is configured
    db.workspace_root = None
    resp = await client.get("/api/workspace/files")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_configure_nonexistent_path(client):
    """POST /api/workspace/configure with bad path returns 400."""
    resp = await client.post(
        "/api/workspace/configure",
        json={"path": "/nonexistent/fake/path/xyz123"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_configure_valid_path(client, tmp_workspace):
    """Configure with a valid tmp_workspace returns 200."""
    resp = await client.post(
        "/api/workspace/configure",
        json={"path": str(tmp_workspace)},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    # Cleanup
    db.workspace_root = None
    workspace.schema_cache.clear()


@pytest.mark.asyncio
async def test_files_lists_csv_and_parquet(configured_client, tmp_workspace):
    """After configure, both sample.csv and sample.parquet appear."""
    resp = await configured_client.get("/api/workspace/files")
    assert resp.status_code == 200
    names = [f["name"] for f in resp.json()]
    assert "sample.csv" in names
    assert "sample.parquet" in names


@pytest.mark.asyncio
async def test_files_ignores_non_data_files(configured_client, tmp_workspace):
    """A .txt file in the workspace should not appear in the file list."""
    (tmp_workspace / "notes.txt").write_text("hello")
    resp = await configured_client.get("/api/workspace/files")
    assert resp.status_code == 200
    names = [f["name"] for f in resp.json()]
    assert "notes.txt" not in names


@pytest.mark.asyncio
async def test_schema_returns_columns(configured_client):
    """GET /api/db/schema/sample.csv returns columns with name and type."""
    resp = await configured_client.get("/api/db/schema/sample.csv")
    assert resp.status_code == 200
    data = resp.json()
    assert data["filename"] == "sample.csv"
    columns = data["columns"]
    assert len(columns) > 0
    for col in columns:
        assert "name" in col
        assert "type" in col
    col_names = [c["name"] for c in columns]
    assert "id" in col_names
    assert "name" in col_names
    assert "score" in col_names


@pytest.mark.asyncio
async def test_schema_cached(configured_client):
    """Calling schema twice should populate the cache on first call."""
    # Clear cache to start fresh
    workspace.schema_cache.clear()

    # First call: populates cache
    resp1 = await configured_client.get("/api/db/schema/sample.csv")
    assert resp1.status_code == 200
    assert "sample.csv" in workspace.schema_cache

    # Second call: served from cache
    cached_value = workspace.schema_cache["sample.csv"]
    resp2 = await configured_client.get("/api/db/schema/sample.csv")
    assert resp2.status_code == 200
    # Cache entry should be the same object (not re-queried)
    assert workspace.schema_cache["sample.csv"] is cached_value
