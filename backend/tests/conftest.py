"""Shared fixtures for Medha backend tests."""

from pathlib import Path

import pandas as pd
import pytest
import pytest_asyncio
import httpx

from app.main import app
from app import db, workspace


@pytest.fixture
def tmp_workspace(tmp_path: Path) -> Path:
    """Create a temp workspace with sample data files."""
    # sample.csv: 5 rows
    sample_data = {
        "id": [1, 2, 3, 4, 5],
        "name": ["Alice", "Bob", "Charlie", "Diana", "Eve"],
        "score": [85.5, 92.0, 78.3, 95.1, 88.7],
    }
    df_sample = pd.DataFrame(sample_data)
    df_sample.to_csv(tmp_path / "sample.csv", index=False)

    # sample.parquet from same data
    df_sample.to_parquet(tmp_path / "sample.parquet", index=False)

    # large.csv: 10001 rows to test LIMIT enforcement
    large_data = {
        "id": list(range(1, 10002)),
        "value": [i * 1.1 for i in range(1, 10002)],
    }
    df_large = pd.DataFrame(large_data)
    df_large.to_csv(tmp_path / "large.csv", index=False)

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
