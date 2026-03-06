"""Settings endpoint tests."""

import json
import os
import shutil
from pathlib import Path

import pytest

from app.routers.workspace import SETTINGS_FILE, Settings, load_settings, save_settings


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


@pytest.mark.asyncio
async def test_settings_returns_masked_key(client):
    """GET /api/settings returns masked API key values."""
    # Set a real key
    await client.post(
        "/api/settings",
        json={
            "model_inline": "openai/gpt-4o-mini",
            "model_chat": "openai/gpt-4o-mini",
            "agent_profile": "default",
            "openai_api_key": "sk-test-key-abcdef-12345678",
            "openrouter_api_key": "",
            "lm_studio_url": "http://localhost:1234/v1",
        },
    )
    resp = await client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    masked = data["openai_api_key"]
    # Should be masked with "..." in the middle
    assert "..." in masked
    # Should start with first 4 chars and end with last 4 chars
    assert masked.startswith("sk-t")
    assert masked.endswith("5678")
    # Should NOT be the full original key
    assert masked != "sk-test-key-abcdef-12345678"


@pytest.mark.asyncio
async def test_settings_post_with_mask_does_not_overwrite(client):
    """POST with a masked value should not overwrite the real key."""
    real_key = "sk-real-secret-key-99887766"

    # Set the real key
    await client.post(
        "/api/settings",
        json={
            "model_inline": "openai/gpt-4o-mini",
            "model_chat": "openai/gpt-4o-mini",
            "agent_profile": "default",
            "openai_api_key": real_key,
            "openrouter_api_key": "",
            "lm_studio_url": "http://localhost:1234/v1",
        },
    )

    # GET the masked key
    resp = await client.get("/api/settings")
    masked = resp.json()["openai_api_key"]
    assert "..." in masked

    # POST back with the masked value (simulates frontend sending it back)
    await client.post(
        "/api/settings",
        json={
            "model_inline": "openai/gpt-4o-mini",
            "model_chat": "openai/gpt-4o-mini",
            "agent_profile": "default",
            "openai_api_key": masked,
            "openrouter_api_key": "",
            "lm_studio_url": "http://localhost:1234/v1",
        },
    )

    # Verify the real key is still intact on disk
    stored = load_settings()
    assert stored.openai_api_key == real_key
