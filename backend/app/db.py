"""DuckDB connection manager with path safety, SQL safety, and auto-LIMIT."""

import asyncio
import io
import re
import time
import urllib.parse
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.ipc as ipc

conn: duckdb.DuckDBPyConnection = duckdb.connect()

workspace_root: Path | None = None

active_queries: dict[str, asyncio.Task] = {}

MAX_ROWS = 10000

# Serialize all DuckDB access through a single lock.
# DuckDB's Python binding is not safe for concurrent access from multiple
# threads against the same connection. Since Medha is a local single-user
# tool, serializing queries is acceptable and prevents data corruption.
#
# The lock is created lazily to avoid binding to the wrong event loop
# when the module is imported before asyncio starts.
_db_lock: asyncio.Lock | None = None


def _get_db_lock() -> asyncio.Lock:
    """Get or create the DB lock, lazily bound to the current event loop."""
    global _db_lock
    if _db_lock is None:
        _db_lock = asyncio.Lock()
    return _db_lock


def reset_db_lock() -> None:
    """Reset the lock (for tests that create new event loops)."""
    global _db_lock
    _db_lock = None


# --- SQL safety: block dangerous DuckDB operations ---

BLOCKED_PATTERNS = [
    r'\bCOPY\b',
    r'\bEXPORT\b',
    r'\bINSTALL\b',
    r'\bLOAD\b',
    r'\bATTACH\b',
    r'httpfs',
    r'sqlite_scan',
    # SEC-4: prevent persistent state mutations
    r'\bCREATE\s+TABLE\b',
    r'\bCREATE\s+VIEW\b',
    r'\bDROP\s+TABLE\b',
    r'\bDROP\s+VIEW\b',
    r'\bALTER\b',
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

    # Decode URL-encoded characters to prevent bypasses like ..%2f
    decoded_sql = urllib.parse.unquote(sql)

    if "../" in decoded_sql or "..\\" in decoded_sql:
        raise ValueError("Path traversal ('..') is not allowed in queries.")

    # Check for absolute paths or file:// URIs that are not under workspace_root
    # Matches '/path/to/file' or 'file:///path/to/file'
    abs_path_pattern = re.findall(r"['\"]((?:file://)?/[^'\"]+)['\"]", decoded_sql)
    for p in abs_path_pattern:
        path_to_resolve = p
        if p.startswith("file://"):
            path_to_resolve = p[7:]

        resolved = Path(path_to_resolve).resolve()
        if not resolved.is_relative_to(workspace_root):
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


PAGE_SIZE_DEFAULT = 500
PAGE_SIZE_MAX = 10000


def _execute_sync(
    sql: str,
    params: list | None = None,
    offset: int = 0,
    limit: int | None = None,
) -> dict[str, Any]:
    """Run a query synchronously with server-side pagination.

    Wraps the user's SQL (with safety LIMIT applied) in a subquery,
    then counts total rows and fetches the requested page via
    LIMIT/OFFSET on the outer query.
    """
    _check_path_safety(sql)
    safe_sql = _auto_limit(sql)

    page_limit = min(limit or PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX)

    start = time.perf_counter()

    # 1. Get total row count via COUNT(*) on the limited query
    count_sql = f"SELECT COUNT(*) FROM ({safe_sql}) AS _medha_count"
    count_result = conn.execute(count_sql)
    total_row_count = count_result.fetchone()[0]

    # 2. Fetch the requested page by wrapping in a subquery
    paged_sql = (
        f"SELECT * FROM ({safe_sql}) AS _medha_page "
        f"LIMIT {page_limit} OFFSET {offset}"
    )
    if params:
        result = conn.execute(paged_sql, params)
    else:
        result = conn.execute(paged_sql)

    columns = [desc[0] for desc in result.description] if result.description else []
    rows = result.fetchall()
    duration_ms = round((time.perf_counter() - start) * 1000, 2)

    row_count = len(rows)
    has_more = (offset + row_count) < total_row_count
    truncated = total_row_count >= MAX_ROWS

    return {
        "columns": columns,
        "rows": [list(r) for r in rows],
        "truncated": truncated,
        "row_count": row_count,
        "total_row_count": total_row_count,
        "has_more": has_more,
        "offset": offset,
        "duration_ms": duration_ms,
    }


async def async_execute(
    sql: str,
    params: list | None = None,
    offset: int = 0,
    limit: int | None = None,
) -> dict[str, Any]:
    """Run a DuckDB query off the event loop.

    SQL safety checks run before acquiring the lock so obviously bad
    queries fail fast without blocking other work.
    """
    _check_sql_safety(sql)
    async with _get_db_lock():
        return await asyncio.to_thread(_execute_sync, sql, params, offset, limit)


def _execute_sync_arrow(sql: str, params: list | None = None) -> bytes:
    """Run a query and return Arrow IPC stream bytes (called via asyncio.to_thread)."""
    _check_path_safety(sql)
    safe_sql = _auto_limit(sql)

    start = time.perf_counter()
    if params:
        result = conn.execute(safe_sql, params)
    else:
        result = conn.execute(safe_sql)

    # DuckDB supports fetching as Arrow directly
    arrow_table = result.fetch_arrow_table()
    duration_ms = round((time.perf_counter() - start) * 1000, 2)

    row_count = arrow_table.num_rows
    truncated = row_count >= MAX_ROWS

    # Attach metadata to the schema
    metadata = {
        b"row_count": str(row_count).encode(),
        b"truncated": str(truncated).encode(),
        b"duration_ms": str(duration_ms).encode(),
    }
    arrow_table = arrow_table.replace_schema_metadata(metadata)

    # Serialize to IPC stream bytes
    sink = io.BytesIO()
    writer = ipc.new_stream(sink, arrow_table.schema)
    writer.write_table(arrow_table)
    writer.close()
    return sink.getvalue()


async def async_execute_arrow(
    sql: str, params: list | None = None
) -> bytes:
    """Run a DuckDB query and return Arrow IPC stream bytes."""
    _check_sql_safety(sql)
    async with _get_db_lock():
        return await asyncio.to_thread(_execute_sync_arrow, sql, params)
