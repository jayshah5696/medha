"""LangGraph tools for the chat agent."""

from langchain_core.tools import tool

from app.workspace import get_schema as _get_schema
from app import db


@tool
def get_schema(filename: str) -> str:
    """Get column names and types for a file in the workspace."""
    try:
        cols = _get_schema(filename)
        lines = [f"  {c['name']}: {c['type']}" for c in cols]
        return f"Schema for {filename}:\n" + "\n".join(lines)
    except Exception as e:
        return f"Error getting schema: {e}"


@tool
def sample_data(filename: str, n: int = 5) -> str:
    """Get sample rows from a file. Returns a markdown table."""
    try:
        if db.workspace_root is None:
            return "Error: workspace not configured."
        filepath = db.workspace_root / filename
        result = db.conn.execute(f"SELECT * FROM '{filepath}' LIMIT {n}")
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()

        # Build markdown table
        header = "| " + " | ".join(columns) + " |"
        sep = "| " + " | ".join(["---"] * len(columns)) + " |"
        body_lines = []
        for row in rows:
            body_lines.append("| " + " | ".join(str(v) for v in row) + " |")

        return "\n".join([header, sep] + body_lines)
    except Exception as e:
        return f"Error sampling data: {e}"


@tool
def execute_query(sql: str) -> str:
    """Run a DuckDB SQL query. Returns first 20 rows as markdown table plus row count."""
    try:
        if db.workspace_root is None:
            return "Error: workspace not configured."

        result = db.conn.execute(sql)
        columns = [desc[0] for desc in result.description] if result.description else []
        rows = result.fetchmany(20)
        total = len(rows)

        # Try to get full count
        try:
            remaining = result.fetchall()
            total += len(remaining)
        except Exception:
            pass

        # Build markdown table
        header = "| " + " | ".join(columns) + " |"
        sep = "| " + " | ".join(["---"] * len(columns)) + " |"
        body_lines = []
        for row in rows[:20]:
            body_lines.append("| " + " | ".join(str(v) for v in row) + " |")

        table = "\n".join([header, sep] + body_lines)
        return f"{table}\n\nTotal rows: {total}"
    except Exception as e:
        return f"Error executing query: {e}"
