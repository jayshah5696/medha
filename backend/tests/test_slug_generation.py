"""Tests for smart slug generation using meta config model_slug.

The slug model should:
- Use the cheapest model per provider (from meta config)
- Fall back to timestamp if LLM call fails
- Be called async in background (not block the SSE stream)
- Be overridable by user via settings.model_slug
"""

import re
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from app.routers.chats import generate_slug_from_message, generate_slug_fallback


@pytest.mark.asyncio
async def test_slug_fallback_format():
    """Fallback slug is chat-{timestamp} format."""
    slug = generate_slug_fallback()
    assert re.match(r"^chat-\d{14}$", slug)


@pytest.mark.asyncio
async def test_slug_from_message_uses_model_slug():
    """generate_slug_from_message should use the model_slug from settings,
    not the expensive chat model."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "weekly-sales-analysis"

    with patch("app.routers.chats.litellm") as mock_litellm, \
         patch("app.routers.chats._get_slug_model", return_value="openai/gpt-4.1-nano"):
        mock_litellm.acompletion = AsyncMock(return_value=mock_response)

        slug = await generate_slug_from_message("Show me weekly sales trends")

        # Should have called with the cheap model, not the chat model
        call_kwargs = mock_litellm.acompletion.call_args
        assert call_kwargs.kwargs.get("model") == "openai/gpt-4.1-nano" or \
               call_kwargs[1].get("model") == "openai/gpt-4.1-nano"


@pytest.mark.asyncio
async def test_slug_from_message_returns_clean_kebab():
    """Generated slug should be lowercase kebab-case, no special chars."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "  Weekly Sales Analysis!  "

    with patch("app.routers.chats.litellm") as mock_litellm, \
         patch("app.routers.chats._get_slug_model", return_value="openai/gpt-4o-mini"):
        mock_litellm.acompletion = AsyncMock(return_value=mock_response)

        slug = await generate_slug_from_message("Show me weekly sales trends")

    assert re.match(r"^[a-z0-9][a-z0-9-]*$", slug)
    assert " " not in slug
    assert "!" not in slug


@pytest.mark.asyncio
async def test_slug_from_message_falls_back_on_error():
    """If LLM call fails, fall back to timestamp slug."""
    with patch("app.routers.chats.litellm") as mock_litellm, \
         patch("app.routers.chats._get_slug_model", return_value="openai/gpt-4o-mini"):
        mock_litellm.acompletion = AsyncMock(side_effect=Exception("API down"))

        slug = await generate_slug_from_message("anything")

    assert slug.startswith("chat-")


@pytest.mark.asyncio
async def test_slug_from_message_falls_back_on_empty():
    """If LLM returns empty/garbage, fall back to timestamp slug."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "!!"

    with patch("app.routers.chats.litellm") as mock_litellm, \
         patch("app.routers.chats._get_slug_model", return_value="openai/gpt-4o-mini"):
        mock_litellm.acompletion = AsyncMock(return_value=mock_response)

        slug = await generate_slug_from_message("anything")

    assert slug.startswith("chat-")
