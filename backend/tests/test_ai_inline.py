"""Tests for the inline SQL repair endpoint and prompt composition."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ai.inline import inline_edit


def _mock_response(content: str) -> dict:
    """Build a fake OpenAI-format response dict."""
    return {
        "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
        "model": "test",
    }


@pytest.mark.asyncio
async def test_inline_edit_includes_error_context_in_prompt() -> None:
    mock_resp = _mock_response("SELECT 1;")
    captured_kwargs: dict = {}

    async def fake_acompletion(**kwargs):
        captured_kwargs.update(kwargs)
        return mock_resp

    with patch("app.ai.inline.acompletion", side_effect=fake_acompletion), patch(
        "app.ai.inline.get_schema",
        return_value=[{"name": "id", "type": "INTEGER"}],
    ):
        result = await inline_edit(
            instruction="Fix this DuckDB SQL error. Make the smallest change needed to resolve it.",
            selected_sql="SELEKT 1;",
            active_files=["sample.csv"],
            error_message="Parser Error: syntax error at or near 'SELEKT'",
        )

    assert result == "SELECT 1;"
    user_message = captured_kwargs["messages"][1]["content"]
    assert "<schemas>" in user_message
    assert "<sql>" in user_message
    assert "<duckdb_error>" in user_message
    assert "Parser Error: syntax error at or near 'SELEKT'" in user_message


@pytest.mark.asyncio
async def test_ai_inline_endpoint_passes_error_message(client) -> None:
    with patch("app.ai.inline.inline_edit", new=AsyncMock(return_value="SELECT 1;")) as mock_inline_edit:
        response = await client.post(
            "/api/ai/inline",
            json={
                "instruction": "Fix the query",
                "selected_sql": "SELEKT 1;",
                "active_files": ["sample.csv"],
                "error_message": "Parser Error: syntax error at or near 'SELEKT'",
            },
        )

    assert response.status_code == 200
    assert response.json() == {"sql": "SELECT 1;"}
    assert mock_inline_edit.await_args.kwargs["error_message"] == "Parser Error: syntax error at or near 'SELEKT'"
