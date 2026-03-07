"""Tests for Apache Arrow IPC query response format.

Spec §4D: Query endpoint should support format: "arrow" returning
Arrow IPC serialized bytes.

These tests verify:
1. format="arrow" returns Arrow IPC bytes with correct schema.
2. format="json" continues to work as before.
3. Arrow response is deserializable back to a proper table.
4. Arrow response includes correct row count and metadata.
"""

from pathlib import Path

import pyarrow as pa
import pyarrow.ipc as ipc
import pytest

from app import db, workspace


@pytest.fixture(autouse=True)
def setup_workspace(configured_client):
    """Use configured_client to ensure workspace is set up."""
    pass


@pytest.mark.asyncio
async def test_query_json_format_still_works(configured_client, tmp_workspace):
    """format=json should continue returning JSON as before."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 3", "format": "json"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "columns" in data
    assert "rows" in data
    assert data["row_count"] == 3


@pytest.mark.asyncio
async def test_query_arrow_format_returns_bytes(configured_client, tmp_workspace):
    """format=arrow should return application/vnd.apache.arrow.stream bytes."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT id, name, score FROM '{tmp_workspace}/sample.csv' LIMIT 3", "format": "arrow"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("content-type") == "application/vnd.apache.arrow.stream"

    # Deserialize the Arrow IPC bytes
    reader = ipc.open_stream(resp.content)
    table = reader.read_all()

    assert table.num_rows == 3
    assert table.num_columns == 3
    assert "id" in table.column_names
    assert "name" in table.column_names
    assert "score" in table.column_names


@pytest.mark.asyncio
async def test_query_arrow_preserves_types(configured_client, tmp_workspace):
    """Arrow format should preserve column types from DuckDB."""
    resp = await configured_client.post(
        "/api/db/query",
        json={
            "query": "SELECT 42 AS int_val, 3.14 AS float_val, 'hello' AS str_val",
            "format": "arrow",
        },
    )
    assert resp.status_code == 200

    reader = ipc.open_stream(resp.content)
    table = reader.read_all()

    assert table.num_rows == 1
    assert table.column("int_val").to_pylist() == [42]
    assert table.column("str_val").to_pylist() == ["hello"]


@pytest.mark.asyncio
async def test_query_arrow_metadata(configured_client, tmp_workspace):
    """Arrow response should include metadata with row_count, truncated, duration_ms."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv'", "format": "arrow"},
    )
    assert resp.status_code == 200

    reader = ipc.open_stream(resp.content)
    table = reader.read_all()

    # Metadata should be set on the schema
    metadata = table.schema.metadata
    assert metadata is not None
    assert b"row_count" in metadata
    assert b"truncated" in metadata
    assert b"duration_ms" in metadata

    row_count = int(metadata[b"row_count"])
    assert row_count == 5


@pytest.mark.asyncio
async def test_query_arrow_auto_limit(configured_client, tmp_workspace):
    """Arrow format should still respect auto-LIMIT injection."""
    resp = await configured_client.post(
        "/api/db/query",
        json={"query": f"SELECT * FROM '{tmp_workspace}/large.csv'", "format": "arrow"},
    )
    assert resp.status_code == 200

    reader = ipc.open_stream(resp.content)
    table = reader.read_all()

    # large.csv has 10001 rows but auto-limit caps at 10000
    assert table.num_rows == 10000
