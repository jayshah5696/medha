"""Cmd+K inline SQL editing via litellm."""

import asyncio

from fastapi import HTTPException
from litellm import acompletion
from litellm.exceptions import (
    APIConnectionError,
    AuthenticationError,
    RateLimitError,
)

from app.workspace import get_schema


SYSTEM_PROMPT = (
    "You are an expert DuckDB SQL writer. "
    "Output ONLY raw executable SQL. "
    "No markdown, no explanation, no code fences."
)

_PROMPT_FIELD_MAX_CHARS = 1200


def _format_prompt_block(tag: str, value: str) -> str:
    """Wrap prompt data in explicit tags so the model treats it as data."""
    return f"<{tag}>\n{value}\n</{tag}>"


def _trim_prompt_value(value: str, max_chars: int = _PROMPT_FIELD_MAX_CHARS) -> str:
    """Keep prompt fields short enough to avoid sending noisy error blobs."""
    clean_value = value.strip()
    if len(clean_value) <= max_chars:
        return clean_value
    return f"{clean_value[:max_chars].rstrip()}\n...[truncated]"


async def _build_schema_context(active_files: list[str]) -> str:
    """Resolve schema details for the currently active files."""
    schema_parts: list[str] = []
    for filename in active_files:
        try:
            cols = await asyncio.to_thread(get_schema, filename)
        except Exception:
            continue

        col_str = ", ".join(f"{c['name']} ({c['type']})" for c in cols)
        schema_parts.append(f"File: {filename}\nColumns: {col_str}")

    return "\n\n".join(schema_parts) or "No active file schemas available."


def _build_user_message(
    instruction: str,
    selected_sql: str,
    schema_context: str,
    error_message: str | None,
) -> str:
    """Build a prompt that keeps SQL, schema, and error context separate."""
    prompt_blocks = [
        _format_prompt_block("schemas", _trim_prompt_value(schema_context)),
        _format_prompt_block("sql", selected_sql.strip()),
    ]

    if error_message:
        prompt_blocks.append(
            _format_prompt_block("duckdb_error", _trim_prompt_value(error_message))
        )

    prompt_blocks.append(
        _format_prompt_block("instruction", instruction.strip())
    )
    return "\n\n".join(prompt_blocks)


async def inline_edit(
    instruction: str,
    selected_sql: str,
    active_files: list[str],
    model: str = "gpt-4o-mini",
    error_message: str | None = None,
) -> str:
    """Generate edited SQL based on user instruction."""
    schema_context = await _build_schema_context(active_files)
    user_message = _build_user_message(
        instruction=instruction,
        selected_sql=selected_sql,
        schema_context=schema_context,
        error_message=error_message,
    )

    try:
        response = await acompletion(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.0,
        )
    except AuthenticationError:
        raise HTTPException(
            status_code=401,
            detail="Invalid API key. Check Settings.",
        )
    except RateLimitError:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Try again shortly.",
        )
    except APIConnectionError:
        raise HTTPException(
            status_code=503,
            detail="LLM provider unreachable. Check network or LM Studio URL.",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"LLM error: {str(e)}",
        )

    return response.choices[0].message.content.strip()
