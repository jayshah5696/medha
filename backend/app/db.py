"""DuckDB connection manager with path safety, SQL safety, and auto-LIMIT."""

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

# Serialize all DuckDB access through a single lock.
# DuckDB's Python binding is not safe for concurrent access from multiple
# threads against the same connection. Since Medha is a local single-user
# tool, serializing queries is acceptable and prevents data corruption.
_db_lock = asyncio.Lock()


# --- SQL safety: block dangerous DuckDB operations ---

BLOCKED_PATTERNS = [
    r'\bCOPY\b',
    r'\bEXPORT\b',
    r'\bINSTALL\b',
    r'\bLOAD\b',
    r'\bATTACH\b',
    r'httpfs',
    r'sqlite_scan',
]


def _check_sql_safety(sql: str) -> None:
    """Reject queries that contain dangerous DuckDB operations."""
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, sql, re.IGNORECASE):
            clean_name = pattern.replace(r'\b', '')
            raise ValueError(
                f"Operation not permitted: {clean_name} is blocked for security."
            )


def _check_path_safety(sql: str) -> None:
    """Reject queries with directory traversal or paths outside workspace_root."""
    if workspace_root is None:
        raise ValueError(
            "No workspace configured. Set a workspace directory before running queries."
        )
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
    """Run a DuckDB query off the event loop.

    SQL safety checks run before acquiring the lock so obviously bad
    queries fail fast without blocking other work.
    """
    _check_sql_safety(sql)
    async with _db_lock:
        return await asyncio.to_thread(_execute_sync, sql, params)
