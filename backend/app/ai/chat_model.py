"""LangChain BaseChatModel backed by direct OpenAI-compatible HTTP calls.

Replaces ChatLiteLLM + langchain-litellm (which pulled in all of litellm).
Uses app.ai.llm_client for the actual HTTP call, and converts between
LangChain message types and OpenAI wire format.

This is the only module LangGraph interacts with — it must:
1. Implement _generate() and _agenerate() returning ChatResult
2. Implement bind_tools() so create_agent() can attach tool schemas
3. Convert OpenAI-format tool_calls in responses to LangChain ToolCall objects
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable, Sequence

from langchain_core.callbacks import (
    AsyncCallbackManagerForLLMRun,
    CallbackManagerForLLMRun,
)
from langchain_core.language_models import BaseChatModel, LanguageModelInput
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import Runnable
from langchain_core.tools import BaseTool
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import ConfigDict


class ChatDirectAPI(BaseChatModel):
    """Chat model that calls OpenAI-compatible endpoints via httpx.

    Drop-in replacement for ChatLiteLLM. Works with LangGraph's
    create_agent() which calls bind_tools() then _agenerate().

    Args:
        model: Provider-prefixed model string, e.g. "openai/gpt-4o"
        temperature: Sampling temperature (default 0)
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    model: str
    temperature: float = 0.0
    _bound_tools: list[dict[str, Any]] = []

    def __init__(self, **kwargs: Any):
        super().__init__(**kwargs)
        # Private mutable state not managed by pydantic
        object.__setattr__(self, "_bound_tools", [])

    @property
    def _llm_type(self) -> str:
        return "direct-api"

    # ------------------------------------------------------------------
    # Tool binding (called by create_agent -> model.bind_tools(tools))
    # ------------------------------------------------------------------

    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | Callable | BaseTool],
        *,
        tool_choice: str | None = None,
        **kwargs: Any,
    ) -> ChatDirectAPI:
        """Return a copy of this model with tools bound.

        Converts LangChain tool objects to OpenAI function-calling format.
        The bound tools are sent in every request payload.
        """
        openai_tools = []
        for t in tools:
            if isinstance(t, dict):
                openai_tools.append(t)
            else:
                openai_tools.append(convert_to_openai_tool(t))

        # Return a new instance with tools bound
        new = self.__class__(model=self.model, temperature=self.temperature)
        object.__setattr__(new, "_bound_tools", openai_tools)
        return new

    # ------------------------------------------------------------------
    # Message conversion: LangChain -> OpenAI wire format
    # ------------------------------------------------------------------

    @staticmethod
    def _to_openai_messages(messages: list[BaseMessage]) -> list[dict[str, Any]]:
        """Convert LangChain messages to OpenAI API format."""
        result = []
        for msg in messages:
            if isinstance(msg, SystemMessage):
                result.append({"role": "system", "content": msg.content})
            elif isinstance(msg, HumanMessage):
                result.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                entry: dict[str, Any] = {
                    "role": "assistant",
                    "content": msg.content or "",
                }
                # Include tool_calls if present
                if msg.tool_calls:
                    entry["tool_calls"] = [
                        {
                            "id": tc.get("id", f"call_{i}"),
                            "type": "function",
                            "function": {
                                "name": tc["name"],
                                "arguments": (
                                    json.dumps(tc["args"])
                                    if isinstance(tc["args"], dict)
                                    else tc["args"]
                                ),
                            },
                        }
                        for i, tc in enumerate(msg.tool_calls)
                    ]
                result.append(entry)
            elif isinstance(msg, ToolMessage):
                result.append(
                    {
                        "role": "tool",
                        "tool_call_id": msg.tool_call_id,
                        "content": msg.content,
                    }
                )
            else:
                # Fallback: treat as user message
                result.append({"role": "user", "content": str(msg.content)})
        return result

    # ------------------------------------------------------------------
    # Response conversion: OpenAI wire format -> LangChain AIMessage
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_response(data: dict[str, Any]) -> AIMessage:
        """Parse an OpenAI ChatCompletion response into a LangChain AIMessage."""
        choice = data["choices"][0]
        message = choice["message"]
        content = message.get("content") or ""

        # Parse tool_calls from OpenAI format to LangChain ToolCall dicts
        tool_calls = []
        raw_tool_calls = message.get("tool_calls") or []
        for tc in raw_tool_calls:
            func = tc.get("function", {})
            args_str = func.get("arguments", "{}")
            try:
                args = json.loads(args_str) if isinstance(args_str, str) else args_str
            except json.JSONDecodeError:
                args = {"raw": args_str}

            tool_calls.append(
                {
                    "name": func.get("name", ""),
                    "args": args,
                    "id": tc.get("id", ""),
                    "type": "tool_call",
                }
            )

        return AIMessage(
            content=content,
            tool_calls=tool_calls,
            response_metadata={
                "model": data.get("model", ""),
                "finish_reason": choice.get("finish_reason", ""),
            },
        )

    # ------------------------------------------------------------------
    # Core: _generate (sync) and _agenerate (async)
    # ------------------------------------------------------------------

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Synchronous generation — runs the async version in an event loop."""
        return asyncio.get_event_loop().run_until_complete(
            self._agenerate(messages, stop=stop, **kwargs)
        )

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Async generation — the hot path for LangGraph agent execution."""
        from app.ai.llm_client import acompletion

        openai_messages = self._to_openai_messages(messages)

        call_kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": openai_messages,
            "temperature": self.temperature,
        }

        bound_tools = object.__getattribute__(self, "_bound_tools")
        if bound_tools:
            call_kwargs["tools"] = bound_tools

        data = await acompletion(**call_kwargs)
        ai_message = self._parse_response(data)

        return ChatResult(
            generations=[ChatGeneration(message=ai_message)],
        )
