"""LangChain tools for the chat agent.

All query execution goes through the same safety checks (path traversal,
blocked SQL keywords) that the public /api/db/query endpoint uses.
"""

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
        query = f"SELECT * FROM '{filepath}' LIMIT {n}"

        # Enforce the same safety checks as the public query endpoint
        db._check_sql_safety(query)
        db._check_path_safety(query)

        result = db.conn.execute(query)
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
    """Run a DuckDB SQL query. Returns first 20 rows as markdown table plus row count.

    The query is validated against the same path-safety and SQL-safety
    rules that protect the public query endpoint, so the agent cannot
    escape the workspace sandbox or invoke dangerous DuckDB operations.
    """
    try:
        if db.workspace_root is None:
            return "Error: workspace not configured."

        # Enforce safety before touching DuckDB
        db._check_sql_safety(sql)
        db._check_path_safety(sql)

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
