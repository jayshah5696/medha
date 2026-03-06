"""Server-Sent Events endpoint for file change notifications."""

import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.workspace import file_change_queue

router = APIRouter()


@router.get("/api/events")
async def sse_events(request: Request):
    async def generate():
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(
                    file_change_queue.get(), timeout=30.0
                )
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                yield 'data: {"type": "ping"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
