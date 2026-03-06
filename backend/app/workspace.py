"""Workspace file scanning and schema caching."""

import asyncio
from pathlib import Path

from watchfiles import awatch

from app import db

SUPPORTED_EXTENSIONS = {".parquet", ".csv", ".json", ".jsonl"}

schema_cache: dict[str, list[dict]] = {}

file_change_queue: asyncio.Queue = asyncio.Queue()

_watcher_task: asyncio.Task | None = None


async def watch_workspace() -> None:
    """Background task: watch workspace_root for changes, push to queue."""
    if db.workspace_root is None:
        return
    async for changes in awatch(str(db.workspace_root)):
        for change_type, path in changes:
            filename = Path(path).name
            if filename in schema_cache:
                del schema_cache[filename]
            await file_change_queue.put({
                "type": "file_changed",
                "path": filename,
                "change": change_type.name,
            })


def start_watcher() -> None:
    """Start (or restart) the file watcher background task.

    Safe to call from sync context: silently skips if no event loop is running
    (e.g. during tests or before the ASGI server starts).
    """
    global _watcher_task
    if _watcher_task is not None and not _watcher_task.done():
        _watcher_task.cancel()
    try:
        loop = asyncio.get_running_loop()
        _watcher_task = loop.create_task(watch_workspace())
    except RuntimeError:
        # No running event loop (sync context, tests, etc.)
        _watcher_task = None


def stop_watcher() -> None:
    """Stop the file watcher if running."""
    global _watcher_task
    if _watcher_task is not None and not _watcher_task.done():
        _watcher_task.cancel()
    _watcher_task = None


def set_workspace(path: str) -> None:
    """Set the workspace root directory.

    Also sets DuckDB's FILE_SEARCH_PATH so that bare filenames like
    'sample.csv' resolve against the workspace root rather than the
    process CWD.
    """
    p = Path(path).resolve()
    if not p.exists():
        raise FileNotFoundError(f"Workspace path does not exist: {path}")
    if not p.is_dir():
        raise NotADirectoryError(f"Workspace path is not a directory: {path}")
    db.workspace_root = p
    # Tell DuckDB to resolve relative file paths against workspace root
    db.conn.execute(f"SET FILE_SEARCH_PATH='{p}'")
    schema_cache.clear()
    start_watcher()


def scan_files() -> list[dict]:
    """Scan workspace root recursively for supported flat files."""
    if db.workspace_root is None:
        return []
    files = []
    for f in sorted(db.workspace_root.rglob("*")):
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS:
            rel = f.relative_to(db.workspace_root)
            files.append(
                {
                    "name": str(rel),
                    "path": str(f),
                    "size_bytes": f.stat().st_size,
                    "extension": f.suffix.lower(),
                }
            )
    return files


def get_schema(filename: str) -> list[dict]:
    """Get column names and types for a file via DuckDB DESCRIBE.

    NOTE: This is a sync function. When called from async context,
    wrap it in asyncio.to_thread (Priority 3).
    """
    if filename in schema_cache:
        return schema_cache[filename]

    if db.workspace_root is None:
        raise ValueError("Workspace not configured.")

    filepath = db.workspace_root / filename
    if not filepath.exists():
        raise FileNotFoundError(f"File not found: {filename}")

    # Use DuckDB's DESCRIBE to get schema — sync, runs inside
    # asyncio.to_thread when called from the agent tools.
    result = db.conn.execute(f"DESCRIBE SELECT * FROM '{filepath}'")
    columns = []
    for row in result.fetchall():
        columns.append({"name": row[0], "type": row[1]})

    schema_cache[filename] = columns
    return columns
