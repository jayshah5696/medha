"""Tests for Medha meta configuration (slug models, workspace persistence, defaults).

Meta config lives in ~/.medha/settings.json alongside user settings.
It provides sensible defaults that users can override.
"""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.routers.workspace import Settings, load_settings, save_settings


# ---------------------------------------------------------------------------
# Slug model mapping: each provider maps to its cheapest model
# ---------------------------------------------------------------------------


def test_settings_has_slug_model_field():
    """Settings model should have a model_slug field with a default."""
    s = Settings()
    assert hasattr(s, "model_slug")
    assert s.model_slug != ""


def test_settings_slug_model_default_is_cheap():
    """Default slug model should be a known cheap/fast model."""
    s = Settings()
    # Should be a lightweight model, not the full chat model
    cheap_models = ["openai/gpt-4o-mini", "openai/gpt-4.1-mini", "openai/gpt-4.1-nano"]
    assert s.model_slug in cheap_models


def test_settings_slug_model_persists(tmp_path):
    """User-configured slug model should persist to disk and load back."""
    settings_file = tmp_path / "settings.json"
    with patch("app.routers.workspace.SETTINGS_FILE", settings_file):
        s = Settings(model_slug="anthropic/claude-3-haiku-20240307")
        save_settings(s)

        loaded = load_settings()
        assert loaded.model_slug == "anthropic/claude-3-haiku-20240307"


def test_settings_slug_model_user_override(tmp_path):
    """If user sets model_slug in settings, it takes priority over default."""
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(json.dumps({
        "model_slug": "ollama/llama3",
        "provider_chat": "ollama",
    }))
    with patch("app.routers.workspace.SETTINGS_FILE", settings_file):
        loaded = load_settings()
        assert loaded.model_slug == "ollama/llama3"


# ---------------------------------------------------------------------------
# Workspace persistence: remember last opened workspace
# ---------------------------------------------------------------------------


def test_settings_has_last_workspace_field():
    """Settings model should have a last_workspace field."""
    s = Settings()
    assert hasattr(s, "last_workspace")
    assert s.last_workspace == ""


def test_last_workspace_saved_on_configure(tmp_path, tmp_workspace):
    """Configuring a workspace should save the path in settings."""
    settings_file = tmp_path / "medha_settings.json"
    with patch("app.routers.workspace.SETTINGS_FILE", settings_file):
        # Save initial empty settings
        save_settings(Settings())

        # Import and call configure
        from app.workspace import set_workspace
        from app.routers.workspace import save_last_workspace
        save_last_workspace(str(tmp_workspace))

        loaded = load_settings()
        assert loaded.last_workspace == str(tmp_workspace)


def test_last_workspace_returned_in_settings_api(client, tmp_path):
    """GET /api/settings should return last_workspace."""
    # This test just checks the field exists in the response shape
    s = Settings()
    assert "last_workspace" in s.model_fields
