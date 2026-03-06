"""SQL query history endpoints."""

import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

HISTORY_DIR = Path.home() / ".medha" / "history"


class HistoryEntry(BaseModel):
    id: str
    filename: str
    timestamp: str
    preview: str
    duration_ms: float
    row_count: int


def _sanitize_words(sql: str, max_words: int = 4) -> str:
    """Extract first few words from SQL for filename."""
    words = re.sub(r"[^a-zA-Z0-9_\s]", "", sql).split()
    slug = "_".join(words[:max_words]).lower()
    return slug[:40] if slug else "query"


def save_history_entry(
    sql: str,
    duration_ms: float,
    row_count: int,
    truncated: bool,
    workspace_path: str = "",
) -> None:
    """Save a SQL query to the history directory."""
    now = datetime.now()
    date_dir = HISTORY_DIR / now.strftime("%Y-%m-%d")
    date_dir.mkdir(parents=True, exist_ok=True)

    time_prefix = now.strftime("%H-%M-%S")
    sanitized = _sanitize_words(sql)
    filename = f"{time_prefix}_{sanitized}.sql"

    header = (
        f"-- executed: {now.strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"-- duration: {duration_ms}ms\n"
        f"-- rows: {row_count}\n"
        f"-- workspace: {workspace_path}\n"
        f"-- truncated: {str(truncated).lower()}\n"
    )

    filepath = date_dir / filename
    filepath.write_text(header + "\n" + sql)


def _list_history_entries(max_entries: int = 100) -> list[dict]:
    """List history entries, newest first."""
    entries = []
    if not HISTORY_DIR.exists():
        return entries

    date_dirs = sorted(HISTORY_DIR.iterdir(), reverse=True)
    for date_dir in date_dirs:
        if not date_dir.is_dir():
            continue
        sql_files = sorted(date_dir.glob("*.sql"), reverse=True)
        for sql_file in sql_files:
            if len(entries) >= max_entries:
                return entries
            content = sql_file.read_text()
            # Parse header
            duration_ms = 0.0
            row_count = 0
            timestamp = ""
            lines = content.split("\n")
            sql_lines = []
            header_done = False
            for line in lines:
                if not header_done and line.startswith("--"):
                    if "executed:" in line:
                        timestamp = line.split("executed:", 1)[1].strip()
                    elif "duration:" in line:
                        dur_str = line.split("duration:", 1)[1].strip().replace("ms", "")
                        try:
                            duration_ms = float(dur_str)
                        except ValueError:
                            pass
                    elif "rows:" in line:
                        row_str = line.split("rows:", 1)[1].strip()
                        try:
                            row_count = int(row_str)
                        except ValueError:
                            pass
                elif not header_done and line.strip() == "":
                    header_done = True
                else:
                    header_done = True
                    sql_lines.append(line)

            sql_content = "\n".join(sql_lines).strip()
            preview = sql_content[:80] if sql_content else ""

            entry_id = f"{date_dir.name}/{sql_file.name}"
            entries.append({
                "id": entry_id,
                "filename": sql_file.name,
                "timestamp": timestamp,
                "preview": preview,
                "duration_ms": duration_ms,
                "row_count": row_count,
            })

    return entries


@router.get("/api/history")
async def list_history():
    """List history entries, newest first, max 100."""
    return _list_history_entries(100)


@router.get("/api/history/{date}/{filename}")
async def get_history_entry(date: str, filename: str):
    """Return full SQL content for a history entry."""
    filepath = HISTORY_DIR / date / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="History entry not found")
    content = filepath.read_text()
    # Extract SQL content (skip header lines)
    lines = content.split("\n")
    sql_lines = []
    header_done = False
    for line in lines:
        if not header_done and line.startswith("--"):
            continue
        elif not header_done and line.strip() == "":
            header_done = True
        else:
            header_done = True
            sql_lines.append(line)
    return {"sql": "\n".join(sql_lines).strip(), "raw": content}


@router.delete("/api/history")
async def clear_history():
    """Delete all history files."""
    if HISTORY_DIR.exists():
        shutil.rmtree(HISTORY_DIR)
    return {"ok": True}
