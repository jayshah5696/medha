"""Workspace, schema, and settings endpoints."""

import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.workspace import set_workspace, scan_files, get_schema

router = APIRouter()

# --- Settings management ---

SETTINGS_FILE = Path.home() / ".medha" / "settings.json"


class Settings(BaseModel):
    model_inline: str = "openai/gpt-4o-mini"
    model_chat: str = "openai/gpt-4o-mini"
    agent_profile: str = "default"
    openai_api_key: str = ""
    openrouter_api_key: str = ""
    lm_studio_url: str = "http://localhost:1234/v1"


class MaskedSettings(BaseModel):
    model_inline: str = "openai/gpt-4o-mini"
    model_chat: str = "openai/gpt-4o-mini"
    agent_profile: str = "default"
    openai_api_key: str = ""
    openrouter_api_key: str = ""
    lm_studio_url: str = "http://localhost:1234/v1"


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
    try:
        schema = get_schema(filename)
        return {"filename": filename, "columns": schema}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- Settings routes ---


@router.get("/api/settings", response_model=MaskedSettings)
async def get_settings():
    s = load_settings()
    return MaskedSettings(
        model_inline=s.model_inline,
        model_chat=s.model_chat,
        agent_profile=s.agent_profile,
        openai_api_key=mask_key(s.openai_api_key),
        openrouter_api_key=mask_key(s.openrouter_api_key),
        lm_studio_url=s.lm_studio_url,
    )


@router.post("/api/settings")
async def update_settings(req: Settings):
    # Load existing settings so masked values do not overwrite real keys
    existing = load_settings()

    # Only update API keys if the incoming value is not a masked placeholder
    openai_key = req.openai_api_key
    if _is_masked(openai_key):
        openai_key = existing.openai_api_key

    openrouter_key = req.openrouter_api_key
    if _is_masked(openrouter_key):
        openrouter_key = existing.openrouter_api_key

    updated = Settings(
        model_inline=req.model_inline,
        model_chat=req.model_chat,
        agent_profile=req.agent_profile,
        openai_api_key=openai_key,
        openrouter_api_key=openrouter_key,
        lm_studio_url=req.lm_studio_url,
    )

    save_settings(updated)

    # Apply API keys to environment so litellm picks them up immediately
    if updated.openai_api_key:
        os.environ["OPENAI_API_KEY"] = updated.openai_api_key
    if updated.openrouter_api_key:
        os.environ["OPENROUTER_API_KEY"] = updated.openrouter_api_key
    return {"ok": True}
