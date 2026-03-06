"""Cmd+K inline SQL editing via litellm."""

from fastapi import HTTPException
from litellm import acompletion
from litellm.exceptions import (
    RateLimitError,
    AuthenticationError,
    APIConnectionError,
)

from app.workspace import get_schema


SYSTEM_PROMPT = (
    "You are an expert DuckDB SQL writer. "
    "Output ONLY raw executable SQL. "
    "No markdown, no explanation, no code fences."
)


async def inline_edit(
    instruction: str,
    selected_sql: str,
    active_files: list[str],
    model: str = "gpt-4o-mini",
) -> str:
    """Generate edited SQL based on user instruction."""
    import asyncio
    
    # Build schema context
    schema_parts = []
    for filename in active_files:
        try:
            cols = await asyncio.to_thread(get_schema, filename)
            col_str = ", ".join(f"{c['name']} ({c['type']})" for c in cols)
            schema_parts.append(f"File: {filename}\nColumns: {col_str}")
        except Exception:
            pass

    schema_context = "\n\n".join(schema_parts)

    user_message = f"""Available schemas:
{schema_context}

Current SQL:
{selected_sql}

Instruction: {instruction}"""

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
