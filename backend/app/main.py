"""Medha backend: FastAPI + DuckDB + LangGraph."""

# Load .env BEFORE any imports that read os.environ (litellm, langchain, etc.)
from dotenv import load_dotenv
load_dotenv()  # looks for .env in cwd and parent dirs

import re
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import workspace as workspace_router
from app.routers import db as db_router
from app.routers import ai as ai_router
from app.routers import history as history_router
from app.routers import chats as chats_router
from app.routers import events as events_router
from app.routers import models as models_router
from app.routers import queries as queries_router


def _apply_api_keys(settings) -> None:
    """Push saved API keys from settings to os.environ for litellm.

    Only sets non-empty keys — empty strings are skipped so that
    pre-existing values from .env are not clobbered.
    """
    import os

    key_map = {
        "OPENAI_API_KEY": settings.openai_api_key,
        "OPENROUTER_API_KEY": settings.openrouter_api_key,
        "ANTHROPIC_API_KEY": settings.anthropic_api_key,
        "GEMINI_API_KEY": settings.gemini_api_key,
    }
    for env_var, value in key_map.items():
        if value:
            os.environ[env_var] = value


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    from app.routers.workspace import load_settings
    from app.workspace import set_workspace, stop_watcher
    from app import db

    # 1. Load settings and push API keys to os.environ
    settings = load_settings()
    _apply_api_keys(settings)

    # 2. Restore last workspace (silently skip if dir missing/deleted)
    if settings.last_workspace:
        try:
            set_workspace(settings.last_workspace)
        except (FileNotFoundError, NotADirectoryError, ValueError, OSError):
            pass  # dir was moved/deleted — start with no workspace

    yield
    # Shutdown: stop watcher and close DuckDB
    stop_watcher()
    from app.db import conn
    conn.close()


app = FastAPI(title="Medha", version="0.1.0", lifespan=lifespan)

# CORS: allow all localhost origins
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=re.compile(r"^https?://localhost(:\d+)?$").pattern,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(workspace_router.router)
app.include_router(db_router.router)
app.include_router(ai_router.router)
app.include_router(history_router.router)
app.include_router(chats_router.router)
app.include_router(events_router.router)
app.include_router(models_router.router)
app.include_router(queries_router.router)


@app.get("/health")
async def health():
    return {"ok": True}


if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.environ.get("MEDHA_PORT", "18900"))
    uvicorn.run("app.main:app", host="127.0.0.1", port=port)
