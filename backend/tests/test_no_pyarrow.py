"""Tests verifying PyArrow removal and JSON-only query path.

Phase 1 of app-size-optimization: pyarrow, pandas, and the Arrow IPC
endpoint are dead code. These tests verify:

1. pyarrow is NOT importable (removed from deps)
2. pandas is NOT importable (removed from deps)
3. The JSON query path works without pyarrow
4. The Arrow format request returns 400 (removed endpoint)
5. db module has no arrow-related functions
6. DuckDB fetchall() works for all data types without pyarrow
"""

import pytest
import httpx


class TestPyArrowRemoved:
    """Verify pyarrow is no longer a dependency."""

    def test_pyarrow_not_importable(self):
        """pyarrow should not be installed in the project."""
        with pytest.raises(ImportError):
            import pyarrow  # noqa: F401

    def test_pandas_not_importable(self):
        """pandas should not be installed in the project."""
        with pytest.raises(ImportError):
            import pandas  # noqa: F401


class TestDBModuleNoArrow:
    """Verify db module has no arrow-related functions."""

    def test_no_arrow_execute_function(self):
        """db module should not have async_execute_arrow."""
        from app import db

        assert not hasattr(db, "async_execute_arrow")

    def test_no_arrow_sync_function(self):
        """db module should not have _execute_sync_arrow."""
        assert not hasattr(__import__("app.db", fromlist=["db"]), "_execute_sync_arrow")

    def test_no_pyarrow_import_in_db(self):
        """db module source should not import pyarrow."""
        import inspect
        from app import db

        source = inspect.getsource(db)
        assert "import pyarrow" not in source
        assert "from pyarrow" not in source


class TestJSONQueryPathWorks:
    """Verify the JSON query path works without pyarrow."""

    @pytest.mark.asyncio
    async def test_basic_query_json(self, configured_client, tmp_workspace):
        """Standard JSON query still works."""
        resp = await configured_client.post(
            "/api/db/query",
            json={"query": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 3"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["columns"] == ["id", "name", "score"]
        assert data["row_count"] == 3
        assert len(data["rows"]) == 3

    @pytest.mark.asyncio
    async def test_query_with_pagination(self, configured_client, tmp_workspace):
        """Paginated JSON query works."""
        resp = await configured_client.post(
            "/api/db/query",
            json={
                "query": f"SELECT * FROM '{tmp_workspace}/sample.csv'",
                "limit": 2,
                "offset": 0,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["row_count"] == 2
        assert data["has_more"] is True
        assert data["total_row_count"] == 5

    @pytest.mark.asyncio
    async def test_query_various_types(self, configured_client, tmp_workspace):
        """DuckDB fetchall() handles various types without pyarrow."""
        resp = await configured_client.post(
            "/api/db/query",
            json={
                "query": (
                    "SELECT 42 AS int_val, "
                    "3.14 AS float_val, "
                    "'hello' AS str_val, "
                    "TRUE AS bool_val, "
                    "NULL AS null_val, "
                    "CURRENT_DATE AS date_val"
                )
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "int_val" in data["columns"]
        assert data["row_count"] == 1
        row = data["rows"][0]
        assert row[0] == 42
        assert abs(row[1] - 3.14) < 0.001
        assert row[2] == "hello"
        assert row[3] is True
        assert row[4] is None

    @pytest.mark.asyncio
    async def test_parquet_query_without_pyarrow(self, configured_client, tmp_workspace):
        """DuckDB can read parquet files natively, no pyarrow needed."""
        resp = await configured_client.post(
            "/api/db/query",
            json={"query": f"SELECT * FROM '{tmp_workspace}/sample.parquet' LIMIT 3"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["columns"] == ["id", "name", "score"]
        assert data["row_count"] == 3


class TestArrowEndpointRemoved:
    """Verify the Arrow IPC endpoint no longer exists."""

    @pytest.mark.asyncio
    async def test_arrow_format_returns_400(self, configured_client, tmp_workspace):
        """Requesting format=arrow should return 400 (unsupported)."""
        resp = await configured_client.post(
            "/api/db/query",
            json={
                "query": f"SELECT * FROM '{tmp_workspace}/sample.csv'",
                "format": "arrow",
            },
        )
        assert resp.status_code == 400
        assert "unsupported" in resp.json()["detail"].lower() or "format" in resp.json()["detail"].lower()


class TestExportStillWorks:
    """Verify CSV/Parquet export works without pyarrow (DuckDB does this natively)."""

    @pytest.mark.asyncio
    async def test_csv_export(self, configured_client, tmp_workspace):
        """CSV export uses DuckDB COPY, not pyarrow."""
        resp = await configured_client.post(
            "/api/db/export",
            json={
                "query": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 3",
                "format": "csv",
            },
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")

    @pytest.mark.asyncio
    async def test_parquet_export(self, configured_client, tmp_workspace):
        """Parquet export uses DuckDB COPY, not pyarrow."""
        resp = await configured_client.post(
            "/api/db/export",
            json={
                "query": f"SELECT * FROM '{tmp_workspace}/sample.csv' LIMIT 3",
                "format": "parquet",
            },
        )
        assert resp.status_code == 200
