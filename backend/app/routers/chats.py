import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

CHATS_DIR = Path.home() / ".medha" / "chats"

# Priority-5: only allow safe slug characters
_SAFE_SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,127}$")


def _validate_slug(slug: str) -> str:
    """Prevent path traversal via slug param."""
    if not _SAFE_SLUG.match(slug):
        raise HTTPException(status_code=400, detail=f"Invalid slug: {slug!r}")
    return slug


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatThread(BaseModel):
    slug: str
    created_at: str
    model: str = "openai/gpt-4o-mini"
    agent_profile: str = "default"
    active_files: list[str] = []
    messages: list[ChatMessage] = []


class SaveThreadRequest(BaseModel):
    slug: str = ""
    created_at: str = ""
    model: str = "openai/gpt-4o-mini"
    agent_profile: str = "default"
    active_files: list[str] = []
    messages: list[ChatMessage] = []


def generate_slug_fallback() -> str:
    """Fallback slug using timestamp."""
    return f"chat-{datetime.now().strftime('%Y%m%d%H%M%S')}"


import litellm


def _get_slug_model() -> str:
    """Read model_slug from settings. Cheap model for slug generation."""
    try:
        from app.routers.workspace import load_settings
        s = load_settings()
        return s.model_slug or "openai/gpt-4o-mini"
    except Exception:
        return "openai/gpt-4o-mini"


async def generate_slug_from_message(message: str, model: str | None = None) -> str:
    """Try to generate a slug via litellm using the cheap slug model.
    Falls back to timestamp if LLM call fails."""
    slug_model = model or _get_slug_model()
    try:
        response = await litellm.acompletion(
            model=slug_model,
            messages=[
                {
                    "role": "system",
                    "content": "Generate a 2-3 word lowercase kebab-case slug describing this data question. Only output the slug, nothing else.",
                },
                {"role": "user", "content": message},
            ],
            max_tokens=20,
            temperature=0,
        )
        slug = response.choices[0].message.content.strip().lower()
        # Sanitize: only allow lowercase letters, numbers, hyphens
        slug = re.sub(r"[^a-z0-9-]", "", slug)
        slug = re.sub(r"-+", "-", slug).strip("-")
        if slug and len(slug) >= 3:
            return slug
    except Exception:
        pass
    return generate_slug_fallback()


async def generate_slug_from_message_with_timeout(
    message: str,
    timeout: float = 2.0,
    model: str | None = None,
) -> str:
    """BUG-2 fix: Generate slug inline with a timeout.

    Calls generate_slug_from_message with a timeout. If the LLM
    takes longer than `timeout` seconds, falls back to timestamp slug.
    This is called inline (before sending the thread_id SSE event)
    so the frontend gets a descriptive slug immediately.
    """
    try:
        slug = await asyncio.wait_for(
            generate_slug_from_message(message, model),
            timeout=timeout,
        )
        return slug
    except (asyncio.TimeoutError, Exception):
        return generate_slug_fallback()


def _load_thread(slug: str) -> Optional[dict]:
    """Load a thread from disk."""
    path = CHATS_DIR / f"{slug}.json"
    resolved = path.resolve()
    if not resolved.is_relative_to(CHATS_DIR.resolve()):
        return None
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _save_thread(data: dict) -> None:
    """Save a thread to disk."""
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    slug = data["slug"]
    path = CHATS_DIR / f"{slug}.json"
    path.write_text(json.dumps(data, indent=2))


def _list_threads() -> list[dict]:
    """List all threads, newest first."""
    if not CHATS_DIR.exists():
        return []
    threads = []
    for f in CHATS_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            messages = data.get("messages", [])
            preview = ""
            for msg in messages:
                if msg.get("role") == "user":
                    preview = msg.get("content", "")[:80]
                    break
            threads.append({
                "slug": data.get("slug", f.stem),
                "created_at": data.get("created_at", ""),
                "model": data.get("model", ""),
                "message_count": len(messages),
                "preview": preview,
            })
        except (json.JSONDecodeError, KeyError):
            continue
    threads.sort(key=lambda t: t.get("created_at", ""), reverse=True)
    return threads


@router.get("/api/chats")
async def list_chats():
    """List all chat threads, newest first."""
    return await asyncio.to_thread(_list_threads)


@router.get("/api/chats/{slug}")
async def get_chat(slug: str):
    """Get full thread content."""
    _validate_slug(slug)
    thread = await asyncio.to_thread(_load_thread, slug)
    if thread is None:
        raise HTTPException(status_code=404, detail="Chat thread not found")
    return thread


@router.delete("/api/chats/{slug}")
async def delete_chat(slug: str):
    """Delete a chat thread."""
    _validate_slug(slug)
    path = CHATS_DIR / f"{slug}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Chat thread not found")
    await asyncio.to_thread(path.unlink)
    return {"ok": True}


@router.post("/api/chats/{slug}/save")
async def save_chat(slug: str, req: SaveThreadRequest):
    """Save or update a chat thread."""
    _validate_slug(slug)
    data = {
        "slug": slug,
        "created_at": req.created_at or datetime.now(timezone.utc).isoformat(),
        "model": req.model,
        "agent_profile": req.agent_profile,
        "active_files": req.active_files,
        "messages": [m.model_dump() for m in req.messages],
    }
    await asyncio.to_thread(_save_thread, data)
    return {"ok": True, "slug": slug}
