"""Query execution endpoints."""

import asyncio
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.db import async_execute, active_queries, workspace_root, conn, _check_sql_safety, _check_path_safety, _get_db_lock
from app.routers.history import save_history_entry

router = APIRouter()


class QueryRequest(BaseModel):
    query: str
    query_id: str | None = None
    format: str = "json"


@router.post("/api/db/query")
async def run_query(req: QueryRequest):
    qid = req.query_id or str(uuid.uuid4())

    async def _run():
        return await async_execute(req.query)

    task = asyncio.create_task(_run())
    active_queries[qid] = task

    try:
        result = await task
        # Save to history on successful execution
        try:
            ws_path = str(workspace_root) if workspace_root else ""
            save_history_entry(
                sql=req.query,
                duration_ms=result.get("duration_ms", 0),
                row_count=result.get("row_count", 0),
                truncated=result.get("truncated", False),
                workspace_path=ws_path,
                source="user",
                dedup=True,
            )
        except Exception:
            # History save failure should not break queries
            pass
        return result
    except asyncio.CancelledError:
        return {"error": "Query cancelled", "query_id": qid}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        active_queries.pop(qid, None)


@router.delete("/api/db/query/{query_id}")
async def cancel_query(query_id: str):
    task = active_queries.get(query_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Query not found or already finished.")
    task.cancel()
    return {"ok": True, "query_id": query_id}


# ── FEAT-8-4: Export results to CSV / Parquet ──────────────────────


class ExportRequest(BaseModel):
    query: str
    format: str = "csv"  # "csv" or "parquet"


ALLOWED_EXPORT_FORMATS = {"csv", "parquet"}


def _export_sync(query: str, fmt: str) -> str:
    """Run COPY query to temp file via DuckDB (sync, called from thread)."""
    _check_path_safety(query)

    suffix = f".{fmt}"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    tmp.close()

    # DuckDB COPY (query) TO 'file' — bypasses auto-limit intentionally
    # so exports return the full result set.
    stripped = query.strip().rstrip(";")
    copy_sql = f"COPY ({stripped}) TO '{tmp_path}' (FORMAT '{fmt}')"
    conn.execute(copy_sql)
    return tmp_path


@router.post("/api/db/export")
async def export_query(req: ExportRequest):
    """Export query results to CSV or Parquet via DuckDB COPY.

    Bypasses the 10,000 row auto-limit so users get the full result set.
    Still enforces SQL safety checks and workspace path restrictions.
    """
    if req.format not in ALLOWED_EXPORT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {req.format}. Use 'csv' or 'parquet'.",
        )

    try:
        _check_sql_safety(req.query)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        async with _get_db_lock():
            tmp_path = await asyncio.to_thread(_export_sync, req.query, req.format)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    media_type = "text/csv" if req.format == "csv" else "application/octet-stream"
    filename = f"export.{req.format}"

    return FileResponse(
        path=tmp_path,
        filename=filename,
        media_type=media_type,
    )
