"""Workspace and schema endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.workspace import set_workspace, scan_files, get_schema

router = APIRouter()


class ConfigureRequest(BaseModel):
    path: str


@router.get("/api/workspace/files")
async def list_files():
    return scan_files()


@router.post("/api/workspace/configure")
async def configure_workspace(req: ConfigureRequest):
    try:
        set_workspace(req.path)
        return {"ok": True, "path": req.path}
    except (FileNotFoundError, NotADirectoryError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/db/schema/{filename}")
async def file_schema(filename: str):
    try:
        schema = get_schema(filename)
        return {"filename": filename, "columns": schema}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
