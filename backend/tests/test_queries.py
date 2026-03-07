"""Tests for FEAT-8-5: Saved SQL file CRUD endpoints.

Endpoints:
  GET    /api/queries              — list saved .sql files
  GET    /api/queries/{filename}   — read file content
  POST   /api/queries/{filename}   — save/overwrite file content
  PUT    /api/queries/{filename}/rename — rename file
  DELETE /api/queries/{filename}   — delete file
"""

import pytest

from app import db


@pytest.mark.asyncio
async def test_list_queries_empty(configured_client):
    """No saved queries -> empty list."""
    resp = await configured_client.get("/api/queries")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_save_and_list_query(configured_client):
    """Save a query, then list should include it."""
    resp = await configured_client.post(
        "/api/queries/exploration.sql",
        json={"content": "SELECT * FROM train.csv LIMIT 10;"},
    )
    assert resp.status_code == 200

    resp = await configured_client.get("/api/queries")
    assert resp.status_code == 200
    filenames = [q["filename"] for q in resp.json()]
    assert "exploration.sql" in filenames


@pytest.mark.asyncio
async def test_read_query(configured_client):
    """Save then read a query file."""
    sql = "SELECT COUNT(*) FROM train.csv;"
    await configured_client.post(
        "/api/queries/count-query.sql",
        json={"content": sql},
    )

    resp = await configured_client.get("/api/queries/count-query.sql")
    assert resp.status_code == 200
    assert resp.json()["content"] == sql
    assert resp.json()["filename"] == "count-query.sql"


@pytest.mark.asyncio
async def test_read_nonexistent_query(configured_client):
    """Reading a query that doesn't exist returns 404."""
    resp = await configured_client.get("/api/queries/nonexistent.sql")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_overwrite_query(configured_client):
    """Saving to an existing filename overwrites the content."""
    await configured_client.post(
        "/api/queries/my-query.sql",
        json={"content": "SELECT 1;"},
    )
    await configured_client.post(
        "/api/queries/my-query.sql",
        json={"content": "SELECT 2;"},
    )

    resp = await configured_client.get("/api/queries/my-query.sql")
    assert resp.json()["content"] == "SELECT 2;"


@pytest.mark.asyncio
async def test_delete_query(configured_client):
    """Delete a saved query, then it should be gone."""
    await configured_client.post(
        "/api/queries/to-delete.sql",
        json={"content": "SELECT 1;"},
    )
    resp = await configured_client.delete("/api/queries/to-delete.sql")
    assert resp.status_code == 200

    resp = await configured_client.get("/api/queries/to-delete.sql")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_nonexistent_query(configured_client):
    """Deleting a query that doesn't exist returns 404."""
    resp = await configured_client.delete("/api/queries/ghost.sql")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_rename_query(configured_client):
    """Rename a query file."""
    await configured_client.post(
        "/api/queries/old-name.sql",
        json={"content": "SELECT 1;"},
    )
    resp = await configured_client.put(
        "/api/queries/old-name.sql/rename",
        json={"new_name": "new-name.sql"},
    )
    assert resp.status_code == 200

    # Old name should be gone
    resp = await configured_client.get("/api/queries/old-name.sql")
    assert resp.status_code == 404

    # New name should exist with same content
    resp = await configured_client.get("/api/queries/new-name.sql")
    assert resp.status_code == 200
    assert resp.json()["content"] == "SELECT 1;"


@pytest.mark.asyncio
async def test_rename_nonexistent_query(configured_client):
    """Renaming a query that doesn't exist returns 404."""
    resp = await configured_client.put(
        "/api/queries/ghost.sql/rename",
        json={"new_name": "new.sql"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_invalid_filename_blocked(configured_client):
    """Filenames with invalid characters should be rejected."""
    # Filename without .sql extension
    resp = await configured_client.get("/api/queries/notasqlfile.txt")
    assert resp.status_code == 400

    # Filename starting with dot
    resp2 = await configured_client.post(
        "/api/queries/.hidden.sql",
        json={"content": "SELECT 1;"},
    )
    assert resp2.status_code == 400


@pytest.mark.asyncio
async def test_no_workspace_returns_400(client):
    """Queries endpoints require a workspace."""
    db.workspace_root = None
    resp = await client.get("/api/queries")
    assert resp.status_code == 400
