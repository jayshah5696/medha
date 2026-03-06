"""AI tools unit tests (no real LLM calls)."""

from pathlib import Path

import pytest

from app import db, workspace
from app.ai.tools import get_schema, sample_data, execute_query


@pytest.fixture(autouse=True)
def setup_workspace(tmp_workspace: Path):
    """Configure the workspace for every test in this module."""
    workspace.set_workspace(str(tmp_workspace))
    yield
    db.workspace_root = None
    workspace.schema_cache.clear()


def test_get_schema_tool(tmp_workspace):
    """get_schema tool returns column names for sample.csv."""
    result = get_schema.invoke({"filename": "sample.csv"})
    assert isinstance(result, str)
    assert "id" in result
    assert "name" in result
    assert "score" in result
    assert "Schema for sample.csv" in result


def test_sample_data_tool(tmp_workspace):
    """sample_data tool returns a markdown table with rows."""
    result = sample_data.invoke({"filename": "sample.csv", "n": 3})
    assert isinstance(result, str)
    # Markdown table has pipe-delimited columns
    assert "|" in result
    # Should contain header row with column names
    assert "id" in result
    assert "name" in result
    # Should have separator row
    assert "---" in result


def test_execute_query_tool(tmp_workspace):
    """execute_query tool runs valid SQL and returns markdown rows."""
    result = execute_query.invoke(
        {"sql": f"SELECT id, name FROM '{tmp_workspace}/sample.csv' LIMIT 3"}
    )
    assert isinstance(result, str)
    assert "|" in result
    assert "id" in result
    assert "name" in result
    assert "Total rows:" in result


def test_execute_query_invalid_sql(tmp_workspace):
    """Invalid SQL returns error string, not an exception."""
    result = execute_query.invoke({"sql": "SELECTTTT NOTHING FROM NOWHERE"})
    assert isinstance(result, str)
    assert "Error" in result
