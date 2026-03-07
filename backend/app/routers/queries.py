"""FEAT-8-5: Saved SQL file CRUD endpoints.

Stores .sql files under the workspace-scoped queries directory:
    ~/.medha/workspaces/{hash}/queries/{filename}.sql
"""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import db
from app.workspace_store import WorkspaceStore

router = APIRouter()

_SAFE_FILENAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}\.sql$")


def _get_queries_dir() -> Path:
    """Get the workspace-scoped queries directory, or raise 400."""
    if db.workspace_root is None:
        raise HTTPException(status_code=400, detail="No workspace configured.")
    store = WorkspaceStore(str(db.workspace_root))
    store.ensure()
    return store.queries_dir


def _validate_filename(filename: str) -> str:
    """Validate filename to prevent path traversal."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")
    if not _SAFE_FILENAME.match(filename):
        raise HTTPException(
            status_code=400,
            detail="Filename must be alphanumeric with dashes/underscores, ending in .sql",
        )
    return filename


class SaveQueryRequest(BaseModel):
    content: str


class RenameQueryRequest(BaseModel):
    new_name: str


@router.get("/api/queries")
async def list_queries():
    """List saved .sql files for the current workspace."""
    queries_dir = _get_queries_dir()
    if not queries_dir.exists():
        return []

    files = []
    for f in sorted(queries_dir.glob("*.sql")):
        files.append({
            "filename": f.name,
            "size_bytes": f.stat().st_size,
        })
    return files


@router.get("/api/queries/{filename}")
async def read_query(filename: str):
    """Read a saved .sql file's content."""
    filename = _validate_filename(filename)
    queries_dir = _get_queries_dir()
    filepath = queries_dir / filename

    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"Query not found: {filename}")

    return {
        "filename": filename,
        "content": filepath.read_text(),
    }


@router.post("/api/queries/{filename}")
async def save_query(filename: str, req: SaveQueryRequest):
    """Save or overwrite a .sql file."""
    filename = _validate_filename(filename)
    queries_dir = _get_queries_dir()
    filepath = queries_dir / filename

    filepath.write_text(req.content)
    return {"ok": True, "filename": filename}


@router.put("/api/queries/{filename}/rename")
async def rename_query(filename: str, req: RenameQueryRequest):
    """Rename a .sql file."""
    filename = _validate_filename(filename)
    new_name = _validate_filename(req.new_name)
    queries_dir = _get_queries_dir()

    old_path = queries_dir / filename
    new_path = queries_dir / new_name

    if not old_path.exists():
        raise HTTPException(status_code=404, detail=f"Query not found: {filename}")

    old_path.rename(new_path)
    return {"ok": True, "old_name": filename, "new_name": new_name}


@router.delete("/api/queries/{filename}")
async def delete_query(filename: str):
    """Delete a .sql file."""
    filename = _validate_filename(filename)
    queries_dir = _get_queries_dir()
    filepath = queries_dir / filename

    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"Query not found: {filename}")

    filepath.unlink()
    return {"ok": True, "filename": filename}
