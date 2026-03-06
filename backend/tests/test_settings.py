"""Settings endpoint tests."""

import json
import os
import shutil
from pathlib import Path

import pytest

from app.routers.workspace import SETTINGS_FILE, Settings


@pytest.fixture(autouse=True)
def clean_settings():
    """Backup and clean settings before/after each test."""
    backup = None
    if SETTINGS_FILE.exists():
        backup = SETTINGS_FILE.read_text()
    yield
    # Restore or remove
    if backup:
        SETTINGS_FILE.write_text(backup)
    elif SETTINGS_FILE.exists():
        SETTINGS_FILE.unlink()
    # Clean up env vars we may have set
    os.environ.pop("OPENAI_API_KEY", None)
    os.environ.pop("OPENROUTER_API_KEY", None)


@pytest.mark.asyncio
async def test_settings_default(client):
    """GET /api/settings returns default Settings object."""
    # Remove settings file if exists so we get defaults
    if SETTINGS_FILE.exists():
        SETTINGS_FILE.unlink()
    resp = await client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["model_inline"] == "openai/gpt-4o-mini"
    assert data["model_chat"] == "openai/gpt-4o-mini"
    assert data["agent_profile"] == "default"


@pytest.mark.asyncio
async def test_settings_save(client):
    """POST /api/settings with valid data returns 200."""
    resp = await client.post(
        "/api/settings",
        json={
            "model_inline": "openai/gpt-4o",
            "model_chat": "openai/gpt-4o",
            "agent_profile": "fast",
            "openai_api_key": "",
            "openrouter_api_key": "",
            "lm_studio_url": "http://localhost:1234/v1",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True


@pytest.mark.asyncio
async def test_settings_persist(client):
    """Save then reload, values match."""
    await client.post(
        "/api/settings",
        json={
            "model_inline": "openai/gpt-4o",
            "model_chat": "anthropic/claude-sonnet-4.6",
            "agent_profile": "deep",
            "openai_api_key": "",
            "openrouter_api_key": "",
            "lm_studio_url": "http://localhost:5555/v1",
        },
    )
    resp = await client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["model_inline"] == "openai/gpt-4o"
    assert data["model_chat"] == "anthropic/claude-sonnet-4.6"
    assert data["agent_profile"] == "deep"
    assert data["lm_studio_url"] == "http://localhost:5555/v1"


@pytest.mark.asyncio
async def test_settings_env_var_injection(client):
    """After POST with openai_api_key, os.environ has it set."""
    await client.post(
        "/api/settings",
        json={
            "model_inline": "openai/gpt-4o-mini",
            "model_chat": "openai/gpt-4o-mini",
            "agent_profile": "default",
            "openai_api_key": "sk-test-key-12345",
            "openrouter_api_key": "",
            "lm_studio_url": "http://localhost:1234/v1",
        },
    )
    assert os.environ.get("OPENAI_API_KEY") == "sk-test-key-12345"
