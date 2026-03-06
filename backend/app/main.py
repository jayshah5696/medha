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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    from app.workspace import start_watcher, stop_watcher
    from app import db
    if db.workspace_root is not None:
        start_watcher()
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


@app.get("/health")
async def health():
    return {"ok": True}
