"""Workspace-scoped storage for chats, history, and queries.

Each workspace gets its own directory under ~/.medha/workspaces/{hash}/
where hash = sha256(absolute_path)[:12]. This isolates state per project
so switching workspaces shows only relevant threads, history, and queries.

Directory structure:
    ~/.medha/
    ├── settings.json
    └── workspaces/
        ├── {hash1}/
        │   ├── meta.json          # { "path": "/data/sales/", "last_opened": "..." }
        │   ├── chats/
        │   ├── history/
        │   └── queries/
        └── {hash2}/
            ├── meta.json
            ├── chats/
            ├── history/
            └── queries/
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

MEDHA_DIR = Path.home() / ".medha"


def workspace_hash(path: str) -> str:
    """Compute a stable 12-char hash for a workspace path.

    Normalizes trailing slashes so /data/sales and /data/sales/ produce
    the same hash.
    """
    normalized = path.rstrip("/")
    return hashlib.sha256(normalized.encode()).hexdigest()[:12]


class WorkspaceStore:
    """Manages workspace-scoped storage directories.

    Usage:
        store = WorkspaceStore("/data/sales")
        store.ensure()  # creates directories + meta.json
        store.chats_dir  # -> ~/.medha/workspaces/{hash}/chats
    """

    def __init__(self, workspace_path: str):
        self.workspace_path = workspace_path
        self.hash = workspace_hash(workspace_path)
        self.root = MEDHA_DIR / "workspaces" / self.hash

    @property
    def chats_dir(self) -> Path:
        return self.root / "chats"

    @property
    def history_dir(self) -> Path:
        return self.root / "history"

    @property
    def queries_dir(self) -> Path:
        return self.root / "queries"

    def ensure(self) -> None:
        """Create workspace directory structure and meta.json if needed."""
        self.chats_dir.mkdir(parents=True, exist_ok=True)
        self.history_dir.mkdir(parents=True, exist_ok=True)
        self.queries_dir.mkdir(parents=True, exist_ok=True)
        self._write_meta()

    def touch(self) -> None:
        """Update last_opened timestamp in meta.json."""
        self._write_meta()

    def _write_meta(self) -> None:
        """Write or update meta.json with workspace path and timestamp."""
        meta_path = self.root / "meta.json"
        meta = {
            "path": self.workspace_path,
            "last_opened": datetime.now(timezone.utc).isoformat(),
        }
        meta_path.write_text(json.dumps(meta, indent=2))


def list_recent_workspaces(limit: int = 20) -> list[dict]:
    """List recently opened workspaces, sorted by last_opened descending.

    Reads meta.json from each workspace directory under ~/.medha/workspaces/.
    """
    workspaces_dir = MEDHA_DIR / "workspaces"
    if not workspaces_dir.exists():
        return []

    entries = []
    for ws_dir in workspaces_dir.iterdir():
        if not ws_dir.is_dir():
            continue
        meta_path = ws_dir / "meta.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text())
            entries.append({
                "path": meta["path"],
                "last_opened": meta["last_opened"],
                "hash": ws_dir.name,
            })
        except (json.JSONDecodeError, KeyError):
            continue

    entries.sort(key=lambda e: e["last_opened"], reverse=True)
    return entries[:limit]
