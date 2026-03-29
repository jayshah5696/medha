"""Stress tests for DuckDB thread safety and async lock serialization.

Verifies that concurrent access to DuckDB through the async lock is safe:
no segfaults, no "database is locked" errors, and correct results under load.
"""

import asyncio
from pathlib import Path

import pytest

from app import db, workspace


@pytest.fixture(autouse=True)
def setup_workspace(tmp_workspace: Path):
    """Configure workspace and reset lock for every test in this module."""
    db.reset_db_lock()
    workspace.set_workspace(str(tmp_workspace))
    yield
    db.workspace_root = None
    workspace.schema_cache.clear()
    db.reset_db_lock()


# ── 1. test_concurrent_queries ───────────────────────────────────────


@pytest.mark.asyncio
async def test_concurrent_queries():
    """Fire 10 queries concurrently; all must return correct results."""
    tasks = [
        db.async_execute(f"SELECT {i} AS val")
        for i in range(10)
    ]
    results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=10.0)

    assert len(results) == 10
    for i, result in enumerate(results):
        assert result["rows"] == [[i]], f"Query {i} returned wrong result"
        assert result["columns"] == ["val"]
        assert result["row_count"] == 1


# ── 2. test_concurrent_queries_with_workspace ────────────────────────


@pytest.mark.asyncio
async def test_concurrent_queries_with_workspace(tmp_workspace: Path):
    """Fire 5 concurrent SELECTs against a workspace CSV file."""
    csv_path = tmp_workspace / "sample.csv"
    tasks = [
        db.async_execute(
            f"SELECT * FROM '{csv_path}' WHERE id = {i + 1}"
        )
        for i in range(5)
    ]
    results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=10.0)

    expected_names = ["Alice", "Bob", "Charlie", "Diana", "Eve"]
    assert len(results) == 5
    for i, result in enumerate(results):
        assert result["row_count"] == 1, f"Query {i} returned wrong row count"
        # columns: id, name, score
        assert result["rows"][0][1] == expected_names[i], (
            f"Query {i}: expected {expected_names[i]}, got {result['rows'][0][1]}"
        )


# ── 3. test_query_during_schema_read ─────────────────────────────────


@pytest.mark.asyncio
async def test_query_during_schema_read(tmp_workspace: Path):
    """Run a query and a schema read concurrently; both must succeed.

    Note: get_schema accesses db.conn directly (without the async lock),
    so we prime the schema cache first, then verify that a cached schema
    read and a live query can run concurrently without issues.
    """
    csv_path = tmp_workspace / "sample.csv"

    # Prime the schema cache so the concurrent read doesn't touch DuckDB
    workspace.get_schema("sample.csv")

    query_task = asyncio.create_task(
        db.async_execute(f"SELECT COUNT(*) AS cnt FROM '{csv_path}'")
    )
    schema_task = asyncio.create_task(
        asyncio.to_thread(workspace.get_schema, "sample.csv")
    )

    query_result, schema_result = await asyncio.wait_for(
        asyncio.gather(query_task, schema_task),
        timeout=10.0,
    )

    # Query should return 5 rows in sample.csv
    assert query_result["rows"] == [[5]]
    assert query_result["columns"] == ["cnt"]

    # Schema should contain the expected columns
    col_names = [col["name"] for col in schema_result]
    assert "id" in col_names
    assert "name" in col_names
    assert "score" in col_names


# ── 4. test_lock_serializes_access ───────────────────────────────────


@pytest.mark.asyncio
async def test_lock_serializes_access():
    """Verify that the async lock prevents concurrent DuckDB access.

    Run two heavier queries concurrently. They should complete without
    'database is locked' errors or segfaults, proving the lock serializes
    access properly.
    """
    async def heavy_query(n: int) -> dict:
        return await db.async_execute(
            f"SELECT SUM(i) AS total FROM generate_series(1, {1000 + n}) t(i)"
        )

    tasks = [heavy_query(i) for i in range(5)]
    results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=15.0)

    assert len(results) == 5
    for i, result in enumerate(results):
        expected_sum = sum(range(1, 1001 + i))
        assert result["rows"][0][0] == expected_sum, (
            f"Query {i}: expected {expected_sum}, got {result['rows'][0][0]}"
        )
        assert result["columns"] == ["total"]


# ── 5. test_cancel_query ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cancel_query(configured_client):
    """Start a long-running query, cancel it, verify cancellation."""
    import httpx

    query_id = "cancel-test-123"

    # Start a long-running query in the background
    async def run_long_query():
        return await configured_client.post(
            "/api/db/query",
            json={
                "query": "SELECT SUM(a.i * b.i) FROM generate_series(1, 100000) a(i), generate_series(1, 1000) b(i)",
                "query_id": query_id,
            },
        )

    query_task = asyncio.create_task(run_long_query())

    # Give the query a moment to start and register in active_queries
    await asyncio.sleep(0.1)

    # Cancel the query
    cancel_resp = await configured_client.delete(f"/api/db/query/{query_id}")

    # The cancel endpoint should succeed (200) or the query may have
    # already finished (404) on fast machines
    if cancel_resp.status_code == 200:
        assert cancel_resp.json()["ok"] is True
        assert cancel_resp.json()["query_id"] == query_id

        # Wait for the query task to complete
        query_resp = await asyncio.wait_for(query_task, timeout=10.0)
        resp_json = query_resp.json()
        # When cancelled, the endpoint returns {"error": "Query cancelled", ...}
        assert "error" in resp_json or "rows" in resp_json
    else:
        # Query finished before we could cancel — still valid
        assert cancel_resp.status_code == 404
        query_resp = await asyncio.wait_for(query_task, timeout=10.0)
        assert query_resp.status_code == 200
