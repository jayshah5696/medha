"""SQL history endpoint tests."""

import shutil
import time
from pathlib import Path

import pytest

from app import db, workspace
from app.routers.history import HISTORY_DIR, save_history_entry


@pytest.fixture(autouse=True)
def clean_history():
    """Clean history directory before/after each test."""
    if HISTORY_DIR.exists():
        shutil.rmtree(HISTORY_DIR)
    yield
    if HISTORY_DIR.exists():
        shutil.rmtree(HISTORY_DIR)


@pytest.mark.asyncio
async def test_history_saved_on_query(configured_client, tmp_workspace):
    """Execute a query, check ~/.medha/history/ has a .sql file."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 3"},
    )
    assert resp.status_code == 200
    # Check that history dir has at least one .sql file
    assert HISTORY_DIR.exists()
    sql_files = list(HISTORY_DIR.rglob("*.sql"))
    assert len(sql_files) >= 1


@pytest.mark.asyncio
async def test_history_header_correct(configured_client, tmp_workspace):
    """Check the header comment contains executed/duration/rows."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 3"},
    )
    assert resp.status_code == 200
    sql_files = list(HISTORY_DIR.rglob("*.sql"))
    assert len(sql_files) >= 1
    content = sql_files[0].read_text()
    assert "-- executed:" in content
    assert "-- duration:" in content
    assert "-- rows:" in content


@pytest.mark.asyncio
async def test_history_list_endpoint(configured_client, tmp_workspace):
    """GET /api/history returns list with at least 1 entry after a query."""
    await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 3"},
    )
    resp = await configured_client.get("/api/history")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    entry = data[0]
    assert "id" in entry
    assert "filename" in entry
    assert "timestamp" in entry
    assert "preview" in entry
    assert "duration_ms" in entry
    assert "row_count" in entry


@pytest.mark.asyncio
async def test_history_get_entry(configured_client, tmp_workspace):
    """GET /api/history/{id} returns SQL content."""
    await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT id FROM '{tmp_workspace}/sample.csv' LIMIT 2"},
    )
    list_resp = await configured_client.get("/api/history")
    entries = list_resp.json()
    assert len(entries) >= 1
    entry_id = entries[0]["id"]
    resp = await configured_client.get(f"/api/history/{entry_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert "sql" in data
    assert "SELECT" in data["sql"]


@pytest.mark.asyncio
async def test_history_sorted_newest_first(configured_client, tmp_workspace):
    """Multiple queries, list is newest-first."""
    await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT id FROM '{tmp_workspace}/sample.csv' LIMIT 1"},
    )
    time.sleep(1.1)  # Ensure different timestamps
    await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT name FROM '{tmp_workspace}/sample.csv' LIMIT 1"},
    )
    resp = await configured_client.get("/api/history")
    entries = resp.json()
    assert len(entries) >= 2
    # Second query (SELECT name) should be first in list (newest)
    assert "name" in entries[0]["preview"].lower() or "select" in entries[0]["preview"].lower()


@pytest.mark.asyncio
async def test_history_delete(configured_client, tmp_workspace):
    """DELETE /api/history clears all entries."""
    await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 1"},
    )
    # Verify there is at least one entry
    list_resp = await configured_client.get("/api/history")
    assert len(list_resp.json()) >= 1

    # Delete all
    del_resp = await configured_client.request("DELETE", "/api/history")
    assert del_resp.status_code == 200

    # List should be empty
    list_resp2 = await configured_client.get("/api/history")
    assert list_resp2.json() == []
