"""Shared fixtures for Medha backend tests."""

import csv
from pathlib import Path

import duckdb
import pytest
import pytest_asyncio
import httpx

from app.main import app
from app import db, workspace


@pytest.fixture
def tmp_workspace(tmp_path: Path) -> Path:
    """Create a temp workspace with sample data files.

    Uses plain csv module and DuckDB COPY for parquet — no pandas/pyarrow.
    """
    # sample.csv: 5 rows
    with open(tmp_path / "sample.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "name", "score"])
        writer.writerows([
            [1, "Alice", 85.5],
            [2, "Bob", 92.0],
            [3, "Charlie", 78.3],
            [4, "Diana", 95.1],
            [5, "Eve", 88.7],
        ])

    # sample.parquet from same data (use DuckDB to create it — no pyarrow)
    _conn = duckdb.connect()
    _conn.execute(
        f"COPY (SELECT * FROM '{tmp_path}/sample.csv') "
        f"TO '{tmp_path}/sample.parquet' (FORMAT PARQUET)"
    )
    _conn.close()

    # large.csv: 10001 rows to test LIMIT enforcement
    with open(tmp_path / "large.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "value"])
        for i in range(1, 10002):
            writer.writerow([i, round(i * 1.1, 1)])

    return tmp_path


@pytest_asyncio.fixture
async def client():
    """Async HTTP client wired to the FastAPI app (no server needed)."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def configured_client(client: httpx.AsyncClient, tmp_workspace: Path):
    """Client with workspace already configured. Resets state after test."""
    resp = await client.post(
        "/api/workspace/configure",
        json={"path": str(tmp_workspace)},
    )
    assert resp.status_code == 200
    yield client
    # Teardown: reset workspace state so tests stay isolated
    db.workspace_root = None
    workspace.schema_cache.clear()
