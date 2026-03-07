"""Tests for workspace-scoped storage (DESIGN: workspace scoping).

Tests verify:
1. Workspace hash computation is deterministic and stable
2. WorkspaceStore creates proper directory structure
3. Chats and history are scoped to workspace directories
4. Recent workspaces are tracked with metadata
5. Different workspace paths produce different hashes
"""

import json
from pathlib import Path

import pytest

from app.workspace_store import (
    workspace_hash,
    WorkspaceStore,
    list_recent_workspaces,
    MEDHA_DIR,
)


# ────────────────────────────────────────────────────────────────────
# Hash computation
# ────────────────────────────────────────────────────────────────────


def test_workspace_hash_deterministic():
    """Same path always produces the same hash."""
    h1 = workspace_hash("/home/user/data")
    h2 = workspace_hash("/home/user/data")
    assert h1 == h2


def test_workspace_hash_different_paths():
    """Different paths produce different hashes."""
    h1 = workspace_hash("/home/user/data")
    h2 = workspace_hash("/home/user/other")
    assert h1 != h2


def test_workspace_hash_length():
    """Hash is 12 characters (first 12 of sha256 hex digest)."""
    h = workspace_hash("/some/path")
    assert len(h) == 12
    assert h.isalnum()


def test_workspace_hash_normalizes_trailing_slash():
    """Trailing slash should not change the hash."""
    h1 = workspace_hash("/home/user/data")
    h2 = workspace_hash("/home/user/data/")
    assert h1 == h2


# ────────────────────────────────────────────────────────────────────
# WorkspaceStore
# ────────────────────────────────────────────────────────────────────


@pytest.fixture
def ws_store(tmp_path: Path, monkeypatch):
    """WorkspaceStore with MEDHA_DIR redirected to tmp_path."""
    monkeypatch.setattr("app.workspace_store.MEDHA_DIR", tmp_path)
    return WorkspaceStore("/data/sales")


def test_store_creates_directories(ws_store: WorkspaceStore):
    """WorkspaceStore.ensure() creates the workspace directory structure."""
    ws_store.ensure()
    assert ws_store.root.exists()
    assert (ws_store.root / "chats").exists()
    assert (ws_store.root / "history").exists()
    assert (ws_store.root / "queries").exists()


def test_store_meta_json(ws_store: WorkspaceStore):
    """ensure() creates a meta.json with the workspace path."""
    ws_store.ensure()
    meta_path = ws_store.root / "meta.json"
    assert meta_path.exists()
    meta = json.loads(meta_path.read_text())
    assert meta["path"] == "/data/sales"
    assert "last_opened" in meta


def test_store_chats_dir(ws_store: WorkspaceStore):
    """chats_dir points inside the workspace directory."""
    ws_store.ensure()
    assert ws_store.chats_dir == ws_store.root / "chats"


def test_store_history_dir(ws_store: WorkspaceStore):
    """history_dir points inside the workspace directory."""
    ws_store.ensure()
    assert ws_store.history_dir == ws_store.root / "history"


def test_store_queries_dir(ws_store: WorkspaceStore):
    """queries_dir points inside the workspace directory."""
    ws_store.ensure()
    assert ws_store.queries_dir == ws_store.root / "queries"


def test_store_touch_updates_last_opened(ws_store: WorkspaceStore):
    """touch() updates the last_opened timestamp in meta.json."""
    ws_store.ensure()
    meta1 = json.loads((ws_store.root / "meta.json").read_text())

    import time
    time.sleep(0.01)  # ensure timestamp differs
    ws_store.touch()

    meta2 = json.loads((ws_store.root / "meta.json").read_text())
    assert meta2["last_opened"] >= meta1["last_opened"]


# ────────────────────────────────────────────────────────────────────
# Recent workspaces
# ────────────────────────────────────────────────────────────────────


def test_list_recent_workspaces_empty(tmp_path: Path, monkeypatch):
    """No workspaces directory -> empty list."""
    monkeypatch.setattr("app.workspace_store.MEDHA_DIR", tmp_path)
    result = list_recent_workspaces()
    assert result == []


def test_list_recent_workspaces(tmp_path: Path, monkeypatch):
    """Multiple workspaces are listed sorted by last_opened descending."""
    monkeypatch.setattr("app.workspace_store.MEDHA_DIR", tmp_path)

    ws1 = WorkspaceStore("/data/sales")
    ws1.ensure()

    import time
    time.sleep(0.01)

    ws2 = WorkspaceStore("/data/logs")
    ws2.ensure()

    recent = list_recent_workspaces()
    assert len(recent) == 2
    # Most recently opened should be first
    assert recent[0]["path"] == "/data/logs"
    assert recent[1]["path"] == "/data/sales"


def test_list_recent_workspaces_has_expected_fields(tmp_path: Path, monkeypatch):
    """Each workspace entry has path and last_opened fields."""
    monkeypatch.setattr("app.workspace_store.MEDHA_DIR", tmp_path)

    ws = WorkspaceStore("/data/test")
    ws.ensure()

    recent = list_recent_workspaces()
    assert len(recent) == 1
    entry = recent[0]
    assert "path" in entry
    assert "last_opened" in entry
    assert "hash" in entry
