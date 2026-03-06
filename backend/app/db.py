"""DuckDB connection manager with path safety and auto-LIMIT."""

import asyncio
import re
import time
from pathlib import Path
from typing import Any

import duckdb

conn: duckdb.DuckDBPyConnection = duckdb.connect()

workspace_root: Path | None = None

active_queries: dict[str, asyncio.Task] = {}

MAX_ROWS = 10000


def _check_path_safety(sql: str) -> None:
    """Reject queries with directory traversal or paths outside workspace_root."""
    if workspace_root is None:
        return
    if "../" in sql:
        raise ValueError("Path traversal ('..') is not allowed in queries.")
    # Check for absolute paths that are not under workspace_root
    abs_path_pattern = re.findall(r"['\"](/[^'\"]+)['\"]", sql)
    root_str = str(workspace_root)
    for p in abs_path_pattern:
        resolved = str(Path(p).resolve())
        if not resolved.startswith(root_str):
            raise ValueError(
                f"Absolute path '{p}' is outside the workspace root."
            )


def _auto_limit(sql: str) -> str:
    """Inject LIMIT if not already present.

    Uses a regex word-boundary check so path substrings like
    '/tmp/test_auto_limit_injected/large.csv' do not fool the detector.
    """
    stripped = sql.strip().rstrip(";")
    if not re.search(r'\bLIMIT\b', stripped, re.IGNORECASE):
        return f"{stripped} LIMIT {MAX_ROWS}"
    return stripped


def _execute_sync(sql: str, params: list | None = None) -> dict[str, Any]:
    """Run a query synchronously (called via asyncio.to_thread)."""
    _check_path_safety(sql)
    safe_sql = _auto_limit(sql)

    start = time.perf_counter()
    if params:
        result = conn.execute(safe_sql, params)
    else:
        result = conn.execute(safe_sql)

    columns = [desc[0] for desc in result.description] if result.description else []
    rows = result.fetchall()
    duration_ms = round((time.perf_counter() - start) * 1000, 2)

    truncated = len(rows) >= MAX_ROWS
    return {
        "columns": columns,
        "rows": [list(r) for r in rows],
        "truncated": truncated,
        "row_count": len(rows),
        "duration_ms": duration_ms,
    }


async def async_execute(
    sql: str, params: list | None = None
) -> dict[str, Any]:
    """Run a DuckDB query off the event loop."""
    return await asyncio.to_thread(_execute_sync, sql, params)
