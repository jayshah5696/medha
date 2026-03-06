"""Query execution endpoints."""

import asyncio
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import async_execute, active_queries, workspace_root
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
