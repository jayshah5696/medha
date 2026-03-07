"""Tests for Phase 7: State persistence across restarts.

Covers:
- _apply_api_keys(): pushing saved API keys to os.environ
- Lifespan workspace restoration from settings.json
- GET /api/boot: single hydration endpoint for frontend
"""

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
import pytest_asyncio
import httpx

from app import db, workspace
from app.routers.workspace import Settings, SETTINGS_FILE, load_settings, save_settings


# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _clean_env():
    """Remove API key env vars before/after each test."""
    keys = [
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
    ]
    saved = {k: os.environ.pop(k, None) for k in keys}
    yield
    # Restore original env
    for k, v in saved.items():
        if v is not None:
            os.environ[k] = v
        else:
            os.environ.pop(k, None)


@pytest.fixture(autouse=True)
def _clean_workspace():
    """Reset workspace state after each test."""
    yield
    db.workspace_root = None
    workspace.schema_cache.clear()
    workspace.stop_watcher()


@pytest.fixture
def settings_with_keys() -> Settings:
    """Settings object with API keys populated."""
    return Settings(
        openai_api_key="sk-test-openai-key-123",
        openrouter_api_key="sk-or-test-key-456",
        anthropic_api_key="sk-ant-test-key-789",
        gemini_api_key="gemini-test-key-abc",
    )


@pytest.fixture
def settings_partial_keys() -> Settings:
    """Settings with only some keys set."""
    return Settings(
        openai_api_key="sk-test-only-openai",
        openrouter_api_key="",
        anthropic_api_key="",
        gemini_api_key="",
    )


@pytest.fixture
def settings_with_workspace(tmp_path: Path) -> Settings:
    """Settings with a valid last_workspace path."""
    # Create a sample data file so scan_files returns something
    (tmp_path / "test.csv").write_text("id,name\n1,Alice\n2,Bob\n")
    return Settings(last_workspace=str(tmp_path))


# ────────────────────────────────────────────────────────────────────
# 1. _apply_api_keys() unit tests
# ────────────────────────────────────────────────────────────────────


class TestApplyApiKeys:
    """Test _apply_api_keys() pushes keys from Settings to os.environ."""

    def test_applies_all_nonempty_keys(self, settings_with_keys: Settings):
        """All four keys set in Settings -> all four in os.environ."""
        from app.main import _apply_api_keys

        _apply_api_keys(settings_with_keys)

        assert os.environ["OPENAI_API_KEY"] == "sk-test-openai-key-123"
        assert os.environ["OPENROUTER_API_KEY"] == "sk-or-test-key-456"
        assert os.environ["ANTHROPIC_API_KEY"] == "sk-ant-test-key-789"
        assert os.environ["GEMINI_API_KEY"] == "gemini-test-key-abc"

    def test_skips_empty_keys(self, settings_partial_keys: Settings):
        """Empty strings in Settings should NOT be pushed to os.environ."""
        from app.main import _apply_api_keys

        _apply_api_keys(settings_partial_keys)

        assert os.environ.get("OPENAI_API_KEY") == "sk-test-only-openai"
        assert "OPENROUTER_API_KEY" not in os.environ
        assert "ANTHROPIC_API_KEY" not in os.environ
        assert "GEMINI_API_KEY" not in os.environ

    def test_settings_keys_override_existing_env(self, settings_with_keys: Settings):
        """Settings.json keys should override pre-existing env vars (.env wins first, then settings overrides)."""
        from app.main import _apply_api_keys

        os.environ["OPENAI_API_KEY"] = "sk-from-dotenv-old"
        _apply_api_keys(settings_with_keys)

        assert os.environ["OPENAI_API_KEY"] == "sk-test-openai-key-123"

    def test_does_not_clobber_env_when_settings_empty(self):
        """If settings has empty key but env has a value, env should be preserved."""
        from app.main import _apply_api_keys

        os.environ["OPENAI_API_KEY"] = "sk-from-dotenv"
        _apply_api_keys(Settings(openai_api_key=""))

        assert os.environ["OPENAI_API_KEY"] == "sk-from-dotenv"


# ────────────────────────────────────────────────────────────────────
# 2. Lifespan workspace restoration tests
# ────────────────────────────────────────────────────────────────────


class TestLifespanWorkspaceRestore:
    """Test that lifespan restores workspace from settings.json.

    These tests exercise the lifespan logic directly by simulating what
    the lifespan function does, rather than trying to re-trigger it
    through ASGI transport (the app object is shared across tests and
    the lifespan only runs once per transport context).
    """

    def test_restores_workspace_from_settings(self, tmp_path: Path):
        """If last_workspace points to a valid dir, set_workspace is called."""
        (tmp_path / "data.csv").write_text("a,b\n1,2\n")
        settings = Settings(last_workspace=str(tmp_path))

        # Simulate what lifespan does: load settings, apply keys, restore workspace
        from app.main import _apply_api_keys
        from app.workspace import set_workspace

        _apply_api_keys(settings)
        if settings.last_workspace:
            try:
                set_workspace(settings.last_workspace)
            except (FileNotFoundError, NotADirectoryError, ValueError, OSError):
                pass

        assert db.workspace_root is not None
        assert db.workspace_root == tmp_path

    def test_ignores_missing_workspace_dir(self):
        """If last_workspace points to a deleted dir, no crash, workspace stays None."""
        settings = Settings(last_workspace="/nonexistent/fake/dir/xyz123")

        from app.main import _apply_api_keys
        from app.workspace import set_workspace

        _apply_api_keys(settings)
        if settings.last_workspace:
            try:
                set_workspace(settings.last_workspace)
            except (FileNotFoundError, NotADirectoryError, ValueError, OSError):
                pass

        assert db.workspace_root is None

    def test_no_workspace_when_empty_string(self):
        """If last_workspace is empty string, no workspace is configured."""
        settings = Settings(last_workspace="")

        from app.main import _apply_api_keys
        from app.workspace import set_workspace

        _apply_api_keys(settings)
        if settings.last_workspace:
            try:
                set_workspace(settings.last_workspace)
            except (FileNotFoundError, NotADirectoryError, ValueError, OSError):
                pass

        assert db.workspace_root is None


# ────────────────────────────────────────────────────────────────────
# 3. GET /api/boot tests — no workspace
# ────────────────────────────────────────────────────────────────────


class TestBootNoWorkspace:
    """Test GET /api/boot when no workspace is configured."""

    @pytest.mark.asyncio
    async def test_boot_response_shape(self, client: httpx.AsyncClient):
        """Boot response has all required top-level keys."""
        resp = await client.get("/api/boot")
        assert resp.status_code == 200
        data = resp.json()
        assert "workspace_path" in data
        assert "files" in data
        assert "threads" in data
        assert "recent_history" in data
        assert "settings" in data

    @pytest.mark.asyncio
    async def test_boot_no_workspace_returns_empty(self, client: httpx.AsyncClient):
        """Without workspace configured, boot returns empty workspace and files."""
        db.workspace_root = None
        resp = await client.get("/api/boot")
        assert resp.status_code == 200
        data = resp.json()
        assert data["workspace_path"] == ""
        assert data["files"] == []

    @pytest.mark.asyncio
    async def test_boot_settings_contain_model_prefs(self, client: httpx.AsyncClient):
        """Boot settings include model preferences."""
        resp = await client.get("/api/boot")
        assert resp.status_code == 200
        settings = resp.json()["settings"]
        assert "model_chat" in settings
        assert "model_inline" in settings
        assert "agent_profile" in settings

    @pytest.mark.asyncio
    async def test_boot_settings_no_api_keys(self, client: httpx.AsyncClient):
        """Boot response must NOT include raw API keys."""
        resp = await client.get("/api/boot")
        assert resp.status_code == 200
        settings = resp.json()["settings"]
        assert "openai_api_key" not in settings
        assert "openrouter_api_key" not in settings
        assert "anthropic_api_key" not in settings
        assert "gemini_api_key" not in settings


# ────────────────────────────────────────────────────────────────────
# 4. GET /api/boot tests — with workspace
# ────────────────────────────────────────────────────────────────────


class TestBootWithWorkspace:
    """Test GET /api/boot when workspace is configured."""

    @pytest.mark.asyncio
    async def test_boot_returns_workspace_and_files(
        self, configured_client: httpx.AsyncClient, tmp_workspace: Path
    ):
        """With workspace configured, boot returns path and file list."""
        resp = await configured_client.get("/api/boot")
        assert resp.status_code == 200
        data = resp.json()
        assert data["workspace_path"] == str(tmp_workspace)
        file_names = [f["name"] for f in data["files"]]
        assert "sample.csv" in file_names
        assert "sample.parquet" in file_names

    @pytest.mark.asyncio
    async def test_boot_includes_threads(
        self, configured_client: httpx.AsyncClient, tmp_path: Path
    ):
        """If chat threads exist on disk, boot includes them."""
        from app.routers.chats import CHATS_DIR

        # Create a test chat thread on disk
        CHATS_DIR.mkdir(parents=True, exist_ok=True)
        thread_data = {
            "slug": "test-boot-thread",
            "created_at": "2026-03-06T12:00:00Z",
            "model": "openai/gpt-4o-mini",
            "messages": [
                {"role": "user", "content": "how many rows?"},
                {"role": "assistant", "content": "42 rows"},
            ],
        }
        thread_file = CHATS_DIR / "test-boot-thread.json"
        thread_file.write_text(json.dumps(thread_data))

        try:
            resp = await configured_client.get("/api/boot")
            assert resp.status_code == 200
            threads = resp.json()["threads"]
            slugs = [t["slug"] for t in threads]
            assert "test-boot-thread" in slugs
        finally:
            # Clean up test thread
            if thread_file.exists():
                thread_file.unlink()

    @pytest.mark.asyncio
    async def test_boot_includes_recent_history(
        self, configured_client: httpx.AsyncClient, tmp_workspace: Path
    ):
        """If query history exists on disk, boot includes it."""
        from app.routers.history import save_history_entry

        save_history_entry(
            sql="SELECT COUNT(*) FROM sample.csv",
            duration_ms=5.0,
            row_count=1,
            truncated=False,
            workspace_path=str(tmp_workspace),
            source="user",
        )

        resp = await configured_client.get("/api/boot")
        assert resp.status_code == 200
        history = resp.json()["recent_history"]
        assert len(history) >= 1
        # Verify the entry has expected fields
        entry = history[0]
        assert "id" in entry
        assert "preview" in entry
        assert "timestamp" in entry
