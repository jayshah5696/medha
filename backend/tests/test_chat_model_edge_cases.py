"""Edge case tests for ChatDirectAPI.

Covers:
- Multi-turn conversations with tool call history
- Empty content responses
- Response metadata propagation
- bind_tools preserves model and temperature
- Concurrent _agenerate calls
- Error propagation from llm_client through _agenerate
"""

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import tool

from app.ai.chat_model import ChatDirectAPI
from app.ai.llm_client import AuthenticationError, RateLimitError, APIConnectionError


# ---------------------------------------------------------------------------
# Multi-turn conversation serialization
# ---------------------------------------------------------------------------


class TestMultiTurnConversation:
    def test_tool_call_roundtrip_serialization(self):
        """Full tool call conversation serializes correctly for the API."""
        messages = [
            SystemMessage(content="You are a data analyst."),
            HumanMessage(content="Show me the schema"),
            AIMessage(
                content="",
                tool_calls=[
                    {"name": "get_schema", "args": {"file": "data.csv"}, "id": "call_1"},
                    {"name": "sample_data", "args": {"file": "data.csv", "n": 5}, "id": "call_2"},
                ],
            ),
            ToolMessage(content="id INT, name VARCHAR", tool_call_id="call_1"),
            ToolMessage(content="1,Alice\n2,Bob", tool_call_id="call_2"),
            AIMessage(content="The file has 2 columns: id and name."),
            HumanMessage(content="Now run a query"),
        ]

        openai_msgs = ChatDirectAPI._to_openai_messages(messages)

        assert len(openai_msgs) == 7

        # System
        assert openai_msgs[0] == {"role": "system", "content": "You are a data analyst."}

        # User
        assert openai_msgs[1] == {"role": "user", "content": "Show me the schema"}

        # AI with tool calls
        ai_msg = openai_msgs[2]
        assert ai_msg["role"] == "assistant"
        assert len(ai_msg["tool_calls"]) == 2
        assert ai_msg["tool_calls"][0]["function"]["name"] == "get_schema"
        assert ai_msg["tool_calls"][1]["function"]["name"] == "sample_data"
        # Arguments should be JSON strings
        assert json.loads(ai_msg["tool_calls"][0]["function"]["arguments"]) == {"file": "data.csv"}
        assert json.loads(ai_msg["tool_calls"][1]["function"]["arguments"]) == {"file": "data.csv", "n": 5}

        # Tool results
        assert openai_msgs[3] == {"role": "tool", "tool_call_id": "call_1", "content": "id INT, name VARCHAR"}
        assert openai_msgs[4] == {"role": "tool", "tool_call_id": "call_2", "content": "1,Alice\n2,Bob"}

        # Final AI
        assert openai_msgs[5]["role"] == "assistant"
        assert openai_msgs[5]["content"] == "The file has 2 columns: id and name."
        assert "tool_calls" not in openai_msgs[5]

        # Follow-up user
        assert openai_msgs[6] == {"role": "user", "content": "Now run a query"}


# ---------------------------------------------------------------------------
# Response edge cases
# ---------------------------------------------------------------------------


class TestResponseEdgeCases:
    def test_empty_content_with_tool_calls(self):
        """Response with empty content but tool_calls should parse fine."""
        data = {
            "choices": [{
                "message": {
                    "content": None,
                    "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "test", "arguments": "{}"}}],
                },
                "finish_reason": "tool_calls",
            }],
            "model": "test",
        }
        msg = ChatDirectAPI._parse_response(data)
        assert msg.content == ""
        assert len(msg.tool_calls) == 1

    def test_response_metadata_propagated(self):
        """Model name and finish_reason should be in response_metadata."""
        data = {
            "choices": [{"message": {"content": "Hi"}, "finish_reason": "stop"}],
            "model": "gpt-4o-2024-08-06",
        }
        msg = ChatDirectAPI._parse_response(data)
        assert msg.response_metadata["model"] == "gpt-4o-2024-08-06"
        assert msg.response_metadata["finish_reason"] == "stop"

    def test_no_tool_calls_key_in_response(self):
        """Response without tool_calls key at all should parse cleanly."""
        data = {
            "choices": [{"message": {"content": "Just text"}, "finish_reason": "stop"}],
            "model": "test",
        }
        msg = ChatDirectAPI._parse_response(data)
        assert msg.tool_calls == []
        assert msg.content == "Just text"

    def test_empty_tool_calls_list(self):
        """Response with empty tool_calls list should parse cleanly."""
        data = {
            "choices": [{"message": {"content": "No tools", "tool_calls": []}, "finish_reason": "stop"}],
            "model": "test",
        }
        msg = ChatDirectAPI._parse_response(data)
        assert msg.tool_calls == []

    def test_tool_call_with_complex_args(self):
        """Tool call with nested object arguments."""
        data = {
            "choices": [{
                "message": {
                    "content": "",
                    "tool_calls": [{
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "execute_query",
                            "arguments": json.dumps({
                                "query": "SELECT * FROM 'data.csv' WHERE score > 90",
                                "limit": 100,
                                "options": {"format": "table"},
                            }),
                        },
                    }],
                },
                "finish_reason": "tool_calls",
            }],
            "model": "test",
        }
        msg = ChatDirectAPI._parse_response(data)
        args = msg.tool_calls[0]["args"]
        assert args["query"] == "SELECT * FROM 'data.csv' WHERE score > 90"
        assert args["limit"] == 100
        assert args["options"]["format"] == "table"

    def test_tool_call_type_field(self):
        """Each parsed tool_call should have type='tool_call' for LangChain."""
        data = {
            "choices": [{
                "message": {
                    "content": "",
                    "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "test", "arguments": "{}"}}],
                },
                "finish_reason": "tool_calls",
            }],
            "model": "test",
        }
        msg = ChatDirectAPI._parse_response(data)
        assert msg.tool_calls[0]["type"] == "tool_call"


# ---------------------------------------------------------------------------
# bind_tools edge cases
# ---------------------------------------------------------------------------


class TestBindToolsEdgeCases:
    def test_bind_tools_preserves_model_and_temperature(self):
        """bind_tools should copy model and temperature to the new instance."""
        model = ChatDirectAPI(model="openrouter/test/model", temperature=0.7)

        @tool
        def dummy(x: str) -> str:
            """Dummy."""
            return x

        bound = model.bind_tools([dummy])
        assert bound.model == "openrouter/test/model"
        assert bound.temperature == 0.7

    def test_bind_tools_multiple_tools(self):
        """bind_tools with multiple tools should include all."""
        model = ChatDirectAPI(model="openai/gpt-4o")

        @tool
        def tool_a(x: str) -> str:
            """Tool A."""
            return x

        @tool
        def tool_b(x: int) -> int:
            """Tool B."""
            return x

        @tool
        def tool_c(x: str, y: int) -> str:
            """Tool C."""
            return f"{x}:{y}"

        bound = model.bind_tools([tool_a, tool_b, tool_c])
        bound_tools = object.__getattribute__(bound, "_bound_tools")
        assert len(bound_tools) == 3
        names = [t["function"]["name"] for t in bound_tools]
        assert "tool_a" in names
        assert "tool_b" in names
        assert "tool_c" in names

    def test_bind_tools_empty_list(self):
        """bind_tools with empty list should work."""
        model = ChatDirectAPI(model="openai/gpt-4o")
        bound = model.bind_tools([])
        bound_tools = object.__getattribute__(bound, "_bound_tools")
        assert bound_tools == []

    def test_bind_tools_mixed_dict_and_tool(self):
        """bind_tools with mix of dicts and BaseTool instances."""
        model = ChatDirectAPI(model="openai/gpt-4o")

        @tool
        def real_tool(x: str) -> str:
            """A real tool."""
            return x

        dict_tool = {
            "type": "function",
            "function": {"name": "dict_tool", "parameters": {"type": "object", "properties": {}}},
        }

        bound = model.bind_tools([real_tool, dict_tool])
        bound_tools = object.__getattribute__(bound, "_bound_tools")
        assert len(bound_tools) == 2
        names = [t["function"]["name"] for t in bound_tools]
        assert "real_tool" in names
        assert "dict_tool" in names


# ---------------------------------------------------------------------------
# Error propagation through _agenerate
# ---------------------------------------------------------------------------


class TestAGenerateErrors:
    @pytest.mark.asyncio
    async def test_auth_error_propagates(self):
        """AuthenticationError from llm_client should propagate through _agenerate."""
        with patch("app.ai.llm_client.acompletion", new=AsyncMock(side_effect=AuthenticationError("bad key"))):
            model = ChatDirectAPI(model="openai/gpt-4o")
            with pytest.raises(AuthenticationError):
                await model._agenerate([HumanMessage(content="test")])

    @pytest.mark.asyncio
    async def test_rate_limit_error_propagates(self):
        """RateLimitError should propagate through _agenerate."""
        with patch("app.ai.llm_client.acompletion", new=AsyncMock(side_effect=RateLimitError("429"))):
            model = ChatDirectAPI(model="openai/gpt-4o")
            with pytest.raises(RateLimitError):
                await model._agenerate([HumanMessage(content="test")])

    @pytest.mark.asyncio
    async def test_connection_error_propagates(self):
        """APIConnectionError should propagate through _agenerate."""
        with patch("app.ai.llm_client.acompletion", new=AsyncMock(side_effect=APIConnectionError("refused"))):
            model = ChatDirectAPI(model="openai/gpt-4o")
            with pytest.raises(APIConnectionError):
                await model._agenerate([HumanMessage(content="test")])


# ---------------------------------------------------------------------------
# Concurrent _agenerate calls
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_agenerate():
    """Multiple concurrent _agenerate calls should all succeed."""
    call_count = 0

    async def counting_acompletion(**kwargs):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.01)
        return {
            "choices": [{"message": {"content": f"Response {call_count}"}, "finish_reason": "stop"}],
            "model": "test",
        }

    with patch("app.ai.llm_client.acompletion", side_effect=counting_acompletion):
        model = ChatDirectAPI(model="openai/gpt-4o")
        tasks = [
            model._agenerate([HumanMessage(content=f"Request {i}")])
            for i in range(5)
        ]
        results = await asyncio.gather(*tasks)

    assert len(results) == 5
    assert call_count == 5
    for r in results:
        assert len(r.generations) == 1
        assert r.generations[0].message.content.startswith("Response")


# ---------------------------------------------------------------------------
# _agenerate sends bound tools
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agenerate_without_tools_omits_tools_key():
    """When no tools are bound, tools should not appear in the call kwargs."""
    captured = {}

    async def capture(**kwargs):
        captured.update(kwargs)
        return {"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}], "model": "t"}

    with patch("app.ai.llm_client.acompletion", side_effect=capture):
        model = ChatDirectAPI(model="openai/gpt-4o")
        await model._agenerate([HumanMessage(content="test")])

    assert "tools" not in captured


# ---------------------------------------------------------------------------
# LangGraph create_agent with multiple tools
# ---------------------------------------------------------------------------


def test_create_agent_with_multiple_tools():
    """create_agent should compile with multiple tools."""
    from langchain.agents import create_agent

    @tool
    def get_schema(file: str) -> str:
        """Get file schema."""
        return "columns"

    @tool
    def sample_data(file: str, n: int = 5) -> str:
        """Get sample data."""
        return "data"

    @tool
    def execute_query(query: str) -> str:
        """Execute SQL query."""
        return "result"

    model = ChatDirectAPI(model="openai/gpt-4o")
    agent = create_agent(
        model,
        [get_schema, sample_data, execute_query],
        system_prompt="You are a SQL analyst.",
    )
    assert agent is not None
    assert callable(getattr(agent, "astream", None))
