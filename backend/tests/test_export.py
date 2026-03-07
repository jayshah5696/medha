"""Tests for FEAT-8-4: Export results to CSV/Parquet."""

import csv
import io
from pathlib import Path

import pyarrow.parquet as pq
import pytest

from app import db, workspace


# ────────────────────────────────────────────────────────────────────
# CSV export tests
# ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_csv_returns_200(configured_client, tmp_workspace):
    """POST /api/db/export with format=csv returns 200 with CSV content."""
    resp = await configured_client.post(
        "/api/db/export",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/sample.csv'",
            "format": "csv",
        },
    )
    assert resp.status_code == 200
    assert "text/csv" in resp.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_export_csv_has_correct_data(configured_client, tmp_workspace):
    """Exported CSV contains the expected rows and columns."""
    resp = await configured_client.post(
        "/api/db/export",
        json={
            "query": f"SELECT id, name FROM '{tmp_workspace}/sample.csv' ORDER BY id",
            "format": "csv",
        },
    )
    assert resp.status_code == 200
    reader = csv.reader(io.StringIO(resp.text))
    rows = list(reader)
    # Header + 5 data rows
    assert len(rows) == 6
    assert rows[0] == ["id", "name"]
    assert rows[1][1] == "Alice"


@pytest.mark.asyncio
async def test_export_csv_no_auto_limit(configured_client, tmp_workspace):
    """Export should return ALL rows, bypassing the 10000 auto-limit."""
    resp = await configured_client.post(
        "/api/db/export",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/large.csv'",
            "format": "csv",
        },
    )
    assert resp.status_code == 200
    reader = csv.reader(io.StringIO(resp.text))
    rows = list(reader)
    # large.csv has 10001 data rows + 1 header
    assert len(rows) == 10002


# ────────────────────────────────────────────────────────────────────
# Parquet export tests
# ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_parquet_returns_200(configured_client, tmp_workspace):
    """POST /api/db/export with format=parquet returns 200."""
    resp = await configured_client.post(
        "/api/db/export",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/sample.csv'",
            "format": "parquet",
        },
    )
    assert resp.status_code == 200
    assert "octet-stream" in resp.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_export_parquet_readable(configured_client, tmp_workspace):
    """Exported parquet file is valid and readable by pyarrow."""
    resp = await configured_client.post(
        "/api/db/export",
        json={
            "query": f"SELECT id, name FROM '{tmp_workspace}/sample.csv'",
            "format": "parquet",
        },
    )
    assert resp.status_code == 200
    # Write response to temp file and read with pyarrow
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as f:
        f.write(resp.content)
        f.flush()
        table = pq.read_table(f.name)
    assert table.num_rows == 5
    assert "id" in table.column_names
    assert "name" in table.column_names


# ────────────────────────────────────────────────────────────────────
# Error handling
# ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_invalid_sql_returns_400(configured_client):
    """Invalid SQL in export should return 400."""
    resp = await configured_client.post(
        "/api/db/export",
        json={
            "query": "SELECT FROM INVALID SYNTAX;;;",
            "format": "csv",
        },
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_export_invalid_format_returns_400(configured_client, tmp_workspace):
    """Unsupported format should return 400."""
    resp = await configured_client.post(
        "/api/db/export",
        json={
            "query": f"SELECT * FROM '{tmp_workspace}/sample.csv'",
            "format": "xlsx",
        },
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_export_blocked_sql_returns_400(configured_client):
    """Dangerous SQL should still be blocked in export."""
    resp = await configured_client.post(
        "/api/db/export",
        json={
            "query": "INSTALL httpfs",
            "format": "csv",
        },
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_export_no_workspace_returns_400(client):
    """Export without workspace configured should return 400."""
    db.workspace_root = None
    resp = await client.post(
        "/api/db/export",
        json={
            "query": "SELECT 1",
            "format": "csv",
        },
    )
    assert resp.status_code == 400
