"""Workspace file scanning and schema caching."""

from pathlib import Path

from app import db

SUPPORTED_EXTENSIONS = {".parquet", ".csv", ".json", ".jsonl"}

schema_cache: dict[str, list[dict]] = {}


def set_workspace(path: str) -> None:
    """Set the workspace root directory."""
    p = Path(path).resolve()
    if not p.exists():
        raise FileNotFoundError(f"Workspace path does not exist: {path}")
    if not p.is_dir():
        raise NotADirectoryError(f"Workspace path is not a directory: {path}")
    db.workspace_root = p
    schema_cache.clear()


def scan_files() -> list[dict]:
    """Scan workspace root for supported flat files."""
    if db.workspace_root is None:
        return []
    files = []
    for f in sorted(db.workspace_root.iterdir()):
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS:
            files.append(
                {
                    "name": f.name,
                    "path": str(f),
                    "size_bytes": f.stat().st_size,
                    "extension": f.suffix.lower(),
                }
            )
    return files


def get_schema(filename: str) -> list[dict]:
    """Get column names and types for a file via DuckDB DESCRIBE."""
    if filename in schema_cache:
        return schema_cache[filename]

    if db.workspace_root is None:
        raise ValueError("Workspace not configured.")

    filepath = db.workspace_root / filename
    if not filepath.exists():
        raise FileNotFoundError(f"File not found: {filename}")

    # Use DuckDB's DESCRIBE to get schema
    result = db.conn.execute(f"DESCRIBE SELECT * FROM '{filepath}'")
    columns = []
    for row in result.fetchall():
        columns.append({"name": row[0], "type": row[1]})

    schema_cache[filename] = columns
    return columns
