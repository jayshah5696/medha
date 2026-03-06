"""AI endpoints: inline edit and chat."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
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
async def ai_chat(req: ChatRequest):
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
            async for chunk in stream_agent_response(
                message=req.message,
                chat_history=chat_history,
                profile=req.profile,
                model_override=req.model,
            ):
                # Track assistant content for saving
                if isinstance(chunk, str) and '"type": "token"' in chunk:
                    try:
                        for line in chunk.strip().split("\n"):
                            if line.startswith("data: "):
                                data = json.loads(line[6:])
                                if data.get("type") == "token":
                                    collected_content += data.get("content", "")
                    except (json.JSONDecodeError, KeyError):
                        pass
                yield chunk
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

        # Generate slug if no thread_id was provided
        if not thread_id:
            try:
                thread_id = await generate_slug_from_message(req.message, req.model)
            except Exception:
                thread_id = generate_slug_fallback()
            yield f'data: {json.dumps({"type": "thread_id", "slug": thread_id})}\n\n'

        # Save thread to disk
        try:
            existing = _load_thread(thread_id)
            messages = []
            if existing:
                messages = existing.get("messages", [])

            messages.append({"role": "user", "content": req.message})
            if collected_content:
                messages.append({"role": "assistant", "content": collected_content})

            _save_thread({
                "slug": thread_id,
                "created_at": existing.get("created_at", datetime.now(timezone.utc).isoformat()) if existing else datetime.now(timezone.utc).isoformat(),
                "model": req.model,
                "agent_profile": req.profile,
                "active_files": req.active_files,
                "messages": messages,
            })
        except Exception:
            pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
