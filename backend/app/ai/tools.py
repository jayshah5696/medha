"""LangChain tools for the chat agent.

All query execution goes through the same safety checks (path traversal,
blocked SQL keywords) that the public /api/db/query endpoint uses.

Thread safety: DuckDB queries are run via asyncio.to_thread through the
db module lock, so agent tool calls never race the public query endpoint.
"""

import asyncio
import time
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from langchain_core.tools import tool

from app.workspace import get_schema as _get_schema
from app import db
from app.routers.history import save_history_entry


def _serialize_value(v: Any) -> Any:
    """Convert DuckDB Python types to JSON-safe primitives."""
    if v is None:
        return None
    if isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, timedelta):
        return str(v)
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, bytes):
        return v.hex()
    if isinstance(v, (list, tuple)):
        return [_serialize_value(x) for x in v]
    if isinstance(v, dict):
        return {k: _serialize_value(val) for k, val in v.items()}
    return str(v)


# Module-level stash for the last execute_query result.
# The streamer pops this after each tool node to emit a query_result event.
_last_query_result: dict[str, Any] | None = None


def _pop_last_query_result() -> dict[str, Any] | None:
    """Pop and return the last stashed query result, or None."""
    global _last_query_result
    result = _last_query_result
    _last_query_result = None
    return result


@tool
async def get_schema(filename: str) -> str:
    """Get column names and types for a file in the workspace."""
    try:
        async with db._get_db_lock():
            cols = await asyncio.to_thread(_get_schema, filename)
        lines = [f"  {c['name']}: {c['type']}" for c in cols]
        return f"Schema for {filename}:\n" + "\n".join(lines)
    except Exception as e:
        return f"Error getting schema: {e}"


@tool
async def sample_data(filename: str, n: int = 5) -> str:
    """Get sample rows from a file. Returns a markdown table."""
    try:
        if db.workspace_root is None:
            return "Error: workspace not configured."
        filepath = db.workspace_root / filename
        query = f"SELECT * FROM '{filepath}' LIMIT {n}"

        # Enforce the same safety checks as the public query endpoint
        db._check_sql_safety(query)
        db._check_path_safety(query)

        def _run():
            result = db.conn.execute(query)
            columns = [desc[0] for desc in result.description]
            rows = result.fetchall()
            return columns, rows

        async with db._get_db_lock():
            columns, rows = await asyncio.to_thread(_run)

        # Build markdown table
        header = "| " + " | ".join(columns) + " |"
        sep = "| " + " | ".join(["---"] * len(columns)) + " |"
        body_lines = []
        for row in rows:
            body_lines.append("| " + " | ".join(str(v) for v in row) + " |")

        return "\n".join([header, sep] + body_lines)
    except Exception as e:
        return f"Error sampling data: {e}"


HITL_ROW_THRESHOLD = 1_000_000  # Trigger HITL warning above this row count


async def _estimate_row_count(sql: str) -> int | None:
    """Estimate how many rows a query will touch via COUNT(*).

    Wraps the query in SELECT COUNT(*) FROM (...) to get an estimate.
    Returns None if estimation fails (don't block the query).
    """
    def _run_count():
        try:
            # Strip trailing semicolons and wrap in COUNT(*)
            stripped = sql.strip().rstrip(";")
            count_sql = f"SELECT COUNT(*) FROM ({stripped})"
            result = db.conn.execute(count_sql)
            row = result.fetchone()
            return row[0] if row else None
        except Exception:
            return None

    async with db._get_db_lock():
        return await asyncio.to_thread(_run_count)


async def _explain_check(sql: str) -> str | None:
    """Run EXPLAIN on the SQL to validate it without executing.

    Returns None if the SQL is valid, or an error message string
    if EXPLAIN fails (syntax error, invalid column, etc.).
    """
    def _run_explain():
        try:
            db.conn.execute(f"EXPLAIN {sql}")
            return None
        except Exception as e:
            return str(e)

    async with db._get_db_lock():
        return await asyncio.to_thread(_run_explain)


@tool
async def execute_query(sql: str) -> str:
    """Run a DuckDB SQL query. Returns first 20 rows as markdown table plus row count.

    The query is validated against the same path-safety and SQL-safety
    rules that protect the public query endpoint, so the agent cannot
    escape the workspace sandbox or invoke dangerous DuckDB operations.

    Before executing, EXPLAIN is run to validate the SQL. If EXPLAIN
    fails, the error is returned immediately without running the query.

    On success, the structured result (columns, rows, timing) is stashed
    in a module-level variable so the streamer can emit a query_result
    SSE event to push the result into the main editor/grid.
    """
    global _last_query_result
    try:
        if db.workspace_root is None:
            return "Error: workspace not configured."

        # Enforce safety before touching DuckDB
        db._check_sql_safety(sql)
        db._check_path_safety(sql)

        # EXPLAIN pre-check: validate SQL without executing (Spec §4E)
        explain_error = await _explain_check(sql)
        if explain_error is not None:
            return f"Error: SQL validation failed: {explain_error}"

        # HITL row estimation: warn if query scans >1M rows (Spec §4E)
        estimated_rows = await _estimate_row_count(sql)
        if estimated_rows is not None and estimated_rows > HITL_ROW_THRESHOLD:
            return (
                f"HITL warning: This query will scan approximately "
                f"{estimated_rows:,} rows. Consider adding filters or a "
                f"LIMIT clause to reduce the scope."
            )

        def _run():
            start = time.perf_counter()
            result = db.conn.execute(sql)
            columns = [desc[0] for desc in result.description] if result.description else []
            rows = result.fetchmany(20)
            total = len(rows)
            # Try to get full count
            try:
                remaining = result.fetchall()
                total += len(remaining)
            except Exception:
                pass
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            return columns, rows, total, duration_ms

        async with db._get_db_lock():
            columns, rows, total, duration_ms = await asyncio.to_thread(_run)

        # Stash structured result for the streamer to pick up.
        # Serialize values so the SSE json.dumps() never crashes on
        # date, Decimal, UUID, etc. returned by DuckDB.
        _last_query_result = {
            "sql": sql,
            "result": {
                "columns": columns,
                "rows": [[_serialize_value(cell) for cell in r] for r in rows[:20]],
                "row_count": total,
                "truncated": total >= db.MAX_ROWS,
                "duration_ms": duration_ms,
            },
        }

        # BUG-3 fix: save agent queries to history
        try:
            ws_path = str(db.workspace_root) if db.workspace_root else ""
            save_history_entry(
                sql=sql,
                duration_ms=duration_ms,
                row_count=total,
                truncated=total >= db.MAX_ROWS,
                workspace_path=ws_path,
                source="agent",
                dedup=True,
            )
        except Exception:
            pass  # History save failure should not break agent queries

        # Build markdown table for the LLM
        header = "| " + " | ".join(columns) + " |"
        sep = "| " + " | ".join(["---"] * len(columns)) + " |"
        body_lines = []
        for row in rows[:20]:
            body_lines.append("| " + " | ".join(str(v) for v in row) + " |")

        table = "\n".join([header, sep] + body_lines)
        return f"{table}\n\nTotal rows: {total}"
    except Exception as e:
        return f"Error executing query: {e}"
