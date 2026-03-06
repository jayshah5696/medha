"""AI endpoints: inline edit and chat."""

import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.ai.inline import inline_edit
from app.ai.agent import stream_agent_response
from app.routers.chats import (
    _load_thread,
    _save_thread,
    generate_slug_from_message,
    generate_slug_fallback,
)

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
    model: str = "openai/gpt-4o-mini"
    profile: str = "default"


async def _save_thread_background(
    thread_id: str,
    req_message: str,
    collected_content: str,
    model: str,
    profile: str,
    active_files: list[str],
) -> None:
    """Background task: save the thread and generate slug if needed."""
    try:
        if not thread_id:
            try:
                thread_id = await generate_slug_from_message(req_message, model)
            except Exception:
                thread_id = generate_slug_fallback()

        existing = _load_thread(thread_id)
        messages = []
        if existing:
            messages = existing.get("messages", [])

        messages.append({"role": "user", "content": req_message})
        if collected_content:
            messages.append({"role": "assistant", "content": collected_content})

        _save_thread({
            "slug": thread_id,
            "created_at": existing.get("created_at", datetime.now(timezone.utc).isoformat()) if existing else datetime.now(timezone.utc).isoformat(),
            "model": model,
            "agent_profile": profile,
            "active_files": active_files,
            "messages": messages,
        })
    except Exception:
        pass  # best-effort persistence


@router.post("/api/ai/inline")
async def ai_inline(req: InlineRequest):
    # inline_edit already raises HTTPException with proper codes
    sql = await inline_edit(
        instruction=req.instruction,
        selected_sql=req.selected_sql,
        active_files=req.active_files,
        model=req.model,
    )
    return {"sql": sql}


@router.post("/api/ai/chat")
async def ai_chat(req: ChatRequest, background_tasks: BackgroundTasks):
    # Load chat history if thread_id provided
    chat_history = []
    thread_data = None
    if req.thread_id:
        thread_data = _load_thread(req.thread_id)
        if thread_data:
            chat_history = thread_data.get("messages", [])

    async def event_stream():
        collected_content = ""
        thread_id = req.thread_id

        try:
            # stream_agent_response now yields typed dicts (BUG-11 fix)
            async for event in stream_agent_response(
                message=req.message,
                chat_history=chat_history,
                profile=req.profile,
                model_override=req.model,
            ):
                # Track assistant content for saving
                if event.get("type") == "token":
                    collected_content += event.get("content", "")

                # Format dict -> SSE at the transport layer
                yield f"data: {json.dumps(event)}\n\n"
        except asyncio.CancelledError:
            # Client disconnected, clean up silently
            return
        except Exception as e:
            error_msg = str(e)
            # Detect common LLM errors and surface friendly messages
            lower = error_msg.lower()
            if "auth" in lower or "api key" in lower or "401" in lower:
                error_msg = "Invalid API key. Check Settings."
            elif "rate" in lower or "429" in lower:
                error_msg = "Rate limit exceeded. Try again shortly."
            elif "connection" in lower or "unreachable" in lower:
                error_msg = "LLM provider unreachable. Check network or LM Studio URL."
            yield f'data: {json.dumps({"type": "error", "message": error_msg})}\n\n'
            return

        # Generate slug inline (fast) if needed, but save in background
        if not thread_id:
            thread_id = generate_slug_fallback()
            yield f'data: {json.dumps({"type": "thread_id", "slug": thread_id})}\n\n'

        # Schedule thread persistence as a background task so the SSE
        # connection closes immediately instead of hanging (BUG-10 fix).
        background_tasks.add_task(
            _save_thread_background,
            thread_id,
            req.message,
            collected_content,
            req.model,
            req.profile,
            req.active_files,
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
