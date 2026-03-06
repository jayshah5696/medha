"""Chat thread persistence endpoints."""

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

CHATS_DIR = Path.home() / ".medha" / "chats"


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


async def generate_slug_from_message(message: str, model: str = "openai/gpt-4o-mini") -> str:
    """Try to generate a slug via litellm. Falls back to timestamp."""
    try:
        import litellm
        response = await litellm.acompletion(
            model=model,
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


def _load_thread(slug: str) -> Optional[dict]:
    """Load a thread from disk."""
    path = CHATS_DIR / f"{slug}.json"
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
    return _list_threads()


@router.get("/api/chats/{slug}")
async def get_chat(slug: str):
    """Get full thread content."""
    thread = _load_thread(slug)
    if thread is None:
        raise HTTPException(status_code=404, detail="Chat thread not found")
    return thread


@router.delete("/api/chats/{slug}")
async def delete_chat(slug: str):
    """Delete a chat thread."""
    path = CHATS_DIR / f"{slug}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Chat thread not found")
    path.unlink()
    return {"ok": True}


@router.post("/api/chats/{slug}/save")
async def save_chat(slug: str, req: SaveThreadRequest):
    """Save or update a chat thread."""
    data = {
        "slug": slug,
        "created_at": req.created_at or datetime.now(timezone.utc).isoformat(),
        "model": req.model,
        "agent_profile": req.agent_profile,
        "active_files": req.active_files,
        "messages": [m.model_dump() for m in req.messages],
    }
    _save_thread(data)
    return {"ok": True, "slug": slug}
