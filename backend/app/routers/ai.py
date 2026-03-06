"""AI endpoints: inline edit and chat."""

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.ai.inline import inline_edit
from app.ai.agent import run_agent_stream

router = APIRouter()


class InlineRequest(BaseModel):
    instruction: str
    selected_sql: str
    active_files: list[str] = []
    model: str = "gpt-4o-mini"


class ChatRequest(BaseModel):
    message: str
    active_files: list[str] = []
    thread_id: str = ""
    model: str = "anthropic/claude-sonnet-4-6"


@router.post("/api/ai/inline")
async def ai_inline(req: InlineRequest):
    try:
        sql = await inline_edit(
            instruction=req.instruction,
            selected_sql=req.selected_sql,
            active_files=req.active_files,
            model=req.model,
        )
        return {"sql": sql}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/ai/chat")
async def ai_chat(req: ChatRequest):
    async def event_stream():
        async for event in run_agent_stream(
            user_message=req.message,
            active_files=req.active_files,
            model_name=req.model,
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
