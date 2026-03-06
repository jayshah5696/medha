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


@router.get("/api/settings")
async def get_settings():
    return load_settings()


@router.post("/api/settings")
async def update_settings(req: Settings):
    save_settings(req)
    # Apply API keys to environment so litellm picks them up immediately
    if req.openai_api_key:
        os.environ["OPENAI_API_KEY"] = req.openai_api_key
    if req.openrouter_api_key:
        os.environ["OPENROUTER_API_KEY"] = req.openrouter_api_key
    return {"ok": True}
