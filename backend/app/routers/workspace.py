"""Workspace, schema, and settings endpoints."""

import json
import os
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.workspace import set_workspace, scan_files, get_schema

router = APIRouter()

# --- Settings management ---

SETTINGS_FILE = Path.home() / ".medha" / "settings.json"


class Settings(BaseModel):
    # Provider-first (SPEC §13)
    provider_inline: str = "openai"
    provider_chat: str = "openai"
    model_inline: str = "openai/gpt-4o-mini"
    model_chat: str = "openai/gpt-4o-mini"
    agent_profile: str = "default"
    # API keys (stored on disk, never returned unmasked)
    openai_api_key: str = ""
    openrouter_api_key: str = ""
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    # Local provider URLs
    lm_studio_url: str = "http://localhost:1234/v1"
    ollama_url: str = "http://localhost:11434"


class MaskedSettings(BaseModel):
    provider_inline: str = "openai"
    provider_chat: str = "openai"
    model_inline: str = "openai/gpt-4o-mini"
    model_chat: str = "openai/gpt-4o-mini"
    agent_profile: str = "default"
    openai_api_key: str = ""
    openrouter_api_key: str = ""
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    lm_studio_url: str = "http://localhost:1234/v1"
    ollama_url: str = "http://localhost:11434"


def mask_key(key: str) -> str:
    """Mask an API key, showing only first 4 and last 4 characters."""
    if not key or len(key) < 8:
        return key
    return f"{key[:4]}...{key[-4:]}"


def _is_masked(value: str) -> bool:
    """Check if a value looks like a masked placeholder."""
    return "..." in value


def load_settings() -> Settings:
    if SETTINGS_FILE.exists():
        return Settings(**json.loads(SETTINGS_FILE.read_text()))
    return Settings()


def save_settings(s: Settings):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(s.model_dump_json(indent=2))
    os.chmod(SETTINGS_FILE, 0o600)


# --- Workspace routes ---


class ConfigureRequest(BaseModel):
    path: str


@router.get("/api/workspace/files")
async def list_files():
    return scan_files()


@router.post("/api/workspace/configure")
async def configure_workspace(req: ConfigureRequest):
    try:
        set_workspace(req.path)
        return {"ok": True, "path": req.path}
    except (FileNotFoundError, NotADirectoryError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/db/schema/{filename}")
async def file_schema(filename: str):
    import asyncio
    try:
        schema = await asyncio.to_thread(get_schema, filename)
        return {"filename": filename, "columns": schema}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class BrowseRequest(BaseModel):
    path: str = ""


class DirEntry(BaseModel):
    name: str
    is_dir: bool


class BrowseResponse(BaseModel):
    current: str
    parent: str | None
    entries: List[DirEntry]


@router.post("/api/workspace/browse")
async def browse_directory(req: BrowseRequest):
    """List directories at a given path for the folder picker."""
    target = Path(req.path) if req.path else Path.home()
    target = target.expanduser().resolve()

    if not target.exists():
        raise HTTPException(status_code=400, detail=f"Path does not exist: {target}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {target}")

    entries: List[DirEntry] = []
    try:
        for child in sorted(target.iterdir(), key=lambda p: p.name.lower()):
            # Skip hidden dirs/files
            if child.name.startswith("."):
                continue
            if child.is_dir():
                entries.append(DirEntry(name=child.name, is_dir=True))
            elif child.suffix.lower() in {".csv", ".parquet", ".json", ".jsonl", ".tsv", ".xlsx"}:
                entries.append(DirEntry(name=child.name, is_dir=False))
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"Permission denied: {target}")

    parent = str(target.parent) if target.parent != target else None
    return BrowseResponse(current=str(target), parent=parent, entries=entries)


# --- Settings routes ---


@router.get("/api/settings", response_model=MaskedSettings)
async def get_settings():
    s = load_settings()
    return MaskedSettings(
        provider_inline=s.provider_inline,
        provider_chat=s.provider_chat,
        model_inline=s.model_inline,
        model_chat=s.model_chat,
        agent_profile=s.agent_profile,
        openai_api_key=mask_key(s.openai_api_key),
        openrouter_api_key=mask_key(s.openrouter_api_key),
        anthropic_api_key=mask_key(s.anthropic_api_key),
        gemini_api_key=mask_key(s.gemini_api_key),
        lm_studio_url=s.lm_studio_url,
        ollama_url=s.ollama_url,
    )


@router.post("/api/settings")
async def update_settings(req: Settings):
    # Load existing settings so masked values do not overwrite real keys
    existing = load_settings()

    def _resolve_key(new_val: str, existing_val: str) -> str:
        return existing_val if _is_masked(new_val) else new_val

    updated = Settings(
        provider_inline=req.provider_inline,
        provider_chat=req.provider_chat,
        model_inline=req.model_inline,
        model_chat=req.model_chat,
        agent_profile=req.agent_profile,
        openai_api_key=_resolve_key(req.openai_api_key, existing.openai_api_key),
        openrouter_api_key=_resolve_key(req.openrouter_api_key, existing.openrouter_api_key),
        anthropic_api_key=_resolve_key(req.anthropic_api_key, existing.anthropic_api_key),
        gemini_api_key=_resolve_key(req.gemini_api_key, existing.gemini_api_key),
        lm_studio_url=req.lm_studio_url,
        ollama_url=req.ollama_url,
    )

    save_settings(updated)

    # Apply API keys to environment so litellm picks them up immediately
    key_env_map = {
        updated.openai_api_key: "OPENAI_API_KEY",
        updated.openrouter_api_key: "OPENROUTER_API_KEY",
        updated.anthropic_api_key: "ANTHROPIC_API_KEY",
        updated.gemini_api_key: "GEMINI_API_KEY",
    }
    for key, env_var in key_env_map.items():
        if key:
            import os
            os.environ[env_var] = key

    return {"ok": True}
