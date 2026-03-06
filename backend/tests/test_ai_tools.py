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


@pytest.mark.asyncio
async def test_get_schema_tool(tmp_workspace):
    """get_schema tool returns column names for sample.csv."""
    result = await get_schema.ainvoke({"filename": "sample.csv"})
    assert isinstance(result, str)
    assert "id" in result
    assert "name" in result
    assert "score" in result
    assert "Schema for sample.csv" in result


@pytest.mark.asyncio
async def test_sample_data_tool(tmp_workspace):
    """sample_data tool returns a markdown table with rows."""
    result = await sample_data.ainvoke({"filename": "sample.csv", "n": 3})
    assert isinstance(result, str)
    # Markdown table has pipe-delimited columns
    assert "|" in result
    # Should contain header row with column names
    assert "id" in result
    assert "name" in result
    # Should have separator row
    assert "---" in result


@pytest.mark.asyncio
async def test_execute_query_tool(tmp_workspace):
    """execute_query tool runs valid SQL and returns markdown rows."""
    result = await execute_query.ainvoke(
        {"sql": f"SELECT id, name FROM '{tmp_workspace}/sample.csv' LIMIT 3"}
    )
    assert isinstance(result, str)
    assert "|" in result
    assert "id" in result
    assert "name" in result
    assert "Total rows:" in result


@pytest.mark.asyncio
async def test_execute_query_invalid_sql(tmp_workspace):
    """Invalid SQL returns error string, not an exception."""
    result = await execute_query.ainvoke({"sql": "SELECTTTT NOTHING FROM NOWHERE"})
    assert isinstance(result, str)
    assert "Error" in result


# --- Query result stash tests (Issue 2) ---


@pytest.mark.asyncio
async def test_execute_query_stashes_result(tmp_workspace):
    """execute_query should stash its structured result for the streamer to pick up."""
    from app.ai.tools import _pop_last_query_result

    # Clear any prior stash
    _pop_last_query_result()

    await execute_query.ainvoke(
        {"sql": f"SELECT id, name FROM '{tmp_workspace}/sample.csv' LIMIT 2"}
    )

    stashed = _pop_last_query_result()
    assert stashed is not None
    assert "sql" in stashed
    assert "result" in stashed
    assert stashed["result"]["columns"] == ["id", "name"]
    assert stashed["result"]["row_count"] == 2
    assert "duration_ms" in stashed["result"]


@pytest.mark.asyncio
async def test_pop_last_query_result_clears_after_read(tmp_workspace):
    """_pop_last_query_result should return the stash once, then None."""
    from app.ai.tools import _pop_last_query_result

    _pop_last_query_result()  # clear

    await execute_query.ainvoke(
        {"sql": f"SELECT id FROM '{tmp_workspace}/sample.csv' LIMIT 1"}
    )

    first = _pop_last_query_result()
    assert first is not None

    second = _pop_last_query_result()
    assert second is None


@pytest.mark.asyncio
async def test_execute_query_no_stash_on_error(tmp_workspace):
    """Failed queries should NOT stash a result."""
    from app.ai.tools import _pop_last_query_result

    _pop_last_query_result()  # clear

    await execute_query.ainvoke({"sql": "SELECTTTT NOTHING"})

    stashed = _pop_last_query_result()
    assert stashed is None


# --- JSON serialization: date/datetime/Decimal must be safe ---


@pytest.mark.asyncio
async def test_execute_query_stash_is_json_serializable(tmp_workspace):
    """Stashed result must be JSON-serializable (no date, Decimal, etc.)."""
    import json
    from app.ai.tools import _pop_last_query_result

    _pop_last_query_result()  # clear

    # Create a CSV with a date column
    date_csv = tmp_workspace / "dates.csv"
    date_csv.write_text("id,event_date\n1,2024-01-15\n2,2024-06-30\n")

    await execute_query.ainvoke(
        {"sql": f"SELECT * FROM '{tmp_workspace}/dates.csv' LIMIT 2"}
    )

    stashed = _pop_last_query_result()
    assert stashed is not None
    # This must not raise TypeError
    serialized = json.dumps(stashed)
    assert "2024-01-15" in serialized
    assert "2024-06-30" in serialized


@pytest.mark.asyncio
async def test_execute_query_stash_handles_various_types(tmp_workspace):
    """Stashed result should handle DuckDB numeric and null types."""
    import json
    from app.ai.tools import _pop_last_query_result

    _pop_last_query_result()  # clear

    await execute_query.ainvoke(
        {"sql": "SELECT 1 AS int_val, 3.14 AS float_val, NULL AS null_val, 'hello' AS str_val"}
    )

    stashed = _pop_last_query_result()
    assert stashed is not None
    serialized = json.dumps(stashed)
    assert "3.14" in serialized
    assert "null" in serialized
    assert "hello" in serialized
