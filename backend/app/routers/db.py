"""Query execution endpoints."""

import asyncio
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import async_execute, active_queries

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
