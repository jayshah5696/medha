"""Tests for ChatDirectAPI — the LangChain BaseChatModel implementation.

Covers:
- Message conversion (LangChain -> OpenAI wire format)
- Response parsing (OpenAI wire format -> LangChain AIMessage with tool_calls)
- bind_tools returns new instance with tools bound
- _agenerate calls llm_client.acompletion correctly
- Integration with LangGraph create_agent (compile-only, no real LLM call)
"""

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


# ---------------------------------------------------------------------------
# Message conversion
# ---------------------------------------------------------------------------


class TestToOpenaiMessages:
    def test_system_message(self):
        msgs = ChatDirectAPI._to_openai_messages([SystemMessage(content="You are helpful")])
        assert msgs == [{"role": "system", "content": "You are helpful"}]

    def test_human_message(self):
        msgs = ChatDirectAPI._to_openai_messages([HumanMessage(content="Hello")])
        assert msgs == [{"role": "user", "content": "Hello"}]

    def test_ai_message_plain(self):
        msgs = ChatDirectAPI._to_openai_messages([AIMessage(content="Hi there")])
        assert msgs[0]["role"] == "assistant"
        assert msgs[0]["content"] == "Hi there"
        assert "tool_calls" not in msgs[0]

    def test_ai_message_with_tool_calls(self):
        ai_msg = AIMessage(
            content="",
            tool_calls=[
                {"name": "get_schema", "args": {"file": "test.csv"}, "id": "call_1"}
            ],
        )
        msgs = ChatDirectAPI._to_openai_messages([ai_msg])
        assert msgs[0]["tool_calls"][0]["function"]["name"] == "get_schema"
        assert msgs[0]["tool_calls"][0]["id"] == "call_1"

    def test_tool_message(self):
        tool_msg = ToolMessage(content="schema result", tool_call_id="call_1")
        msgs = ChatDirectAPI._to_openai_messages([tool_msg])
        assert msgs[0]["role"] == "tool"
        assert msgs[0]["tool_call_id"] == "call_1"

    def test_full_conversation(self):
        """Full agent conversation: system + user + AI(tool_call) + tool_result + AI(answer)."""
        msgs = ChatDirectAPI._to_openai_messages([
            SystemMessage(content="You are a SQL agent"),
            HumanMessage(content="What tables exist?"),
            AIMessage(
                content="",
                tool_calls=[{"name": "get_schema", "args": {"file": "data.csv"}, "id": "c1"}],
            ),
            ToolMessage(content="id INTEGER, name VARCHAR", tool_call_id="c1"),
            AIMessage(content="There's a table with id and name columns."),
        ])
        assert len(msgs) == 5
        assert msgs[0]["role"] == "system"
        assert msgs[1]["role"] == "user"
        assert msgs[2]["role"] == "assistant"
        assert msgs[2]["tool_calls"][0]["function"]["name"] == "get_schema"
        assert msgs[3]["role"] == "tool"
        assert msgs[4]["role"] == "assistant"
        assert msgs[4]["content"] == "There's a table with id and name columns."


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


class TestParseResponse:
    def test_plain_text_response(self):
        data = {
            "choices": [{"message": {"content": "Hello!", "role": "assistant"}, "finish_reason": "stop"}],
            "model": "gpt-4o",
        }
        msg = ChatDirectAPI._parse_response(data)
        assert isinstance(msg, AIMessage)
        assert msg.content == "Hello!"
        assert msg.tool_calls == []

    def test_tool_call_response(self):
        data = {
            "choices": [
                {
                    "message": {
                        "content": "",
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "call_abc123",
                                "type": "function",
                                "function": {
                                    "name": "get_schema",
                                    "arguments": '{"file": "test.csv"}',
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
            "model": "gpt-4o",
        }
        msg = ChatDirectAPI._parse_response(data)
        assert len(msg.tool_calls) == 1
        assert msg.tool_calls[0]["name"] == "get_schema"
        assert msg.tool_calls[0]["args"] == {"file": "test.csv"}
        assert msg.tool_calls[0]["id"] == "call_abc123"

    def test_multiple_tool_calls(self):
        data = {
            "choices": [
                {
                    "message": {
                        "content": "",
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "c1",
                                "type": "function",
                                "function": {"name": "get_schema", "arguments": '{"file": "a.csv"}'},
                            },
                            {
                                "id": "c2",
                                "type": "function",
                                "function": {"name": "sample_data", "arguments": '{"file": "a.csv"}'},
                            },
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
            "model": "gpt-4o",
        }
        msg = ChatDirectAPI._parse_response(data)
        assert len(msg.tool_calls) == 2
        assert msg.tool_calls[0]["name"] == "get_schema"
        assert msg.tool_calls[1]["name"] == "sample_data"

    def test_malformed_args_json(self):
        """If arguments JSON is malformed, should still parse without crashing."""
        data = {
            "choices": [
                {
                    "message": {
                        "content": "",
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "c1",
                                "type": "function",
                                "function": {"name": "test", "arguments": "not valid json"},
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
            "model": "gpt-4o",
        }
        msg = ChatDirectAPI._parse_response(data)
        assert msg.tool_calls[0]["args"] == {"raw": "not valid json"}


# ---------------------------------------------------------------------------
# bind_tools
# ---------------------------------------------------------------------------


class TestBindTools:
    def test_bind_tools_returns_new_instance(self):
        model = ChatDirectAPI(model="openai/gpt-4o")

        @tool
        def my_tool(x: str) -> str:
            """A test tool."""
            return x

        bound = model.bind_tools([my_tool])
        assert isinstance(bound, ChatDirectAPI)
        # Original should not have tools
        assert object.__getattribute__(model, "_bound_tools") == []
        # Bound copy should have tools
        bound_tools = object.__getattribute__(bound, "_bound_tools")
        assert len(bound_tools) == 1
        assert bound_tools[0]["function"]["name"] == "my_tool"

    def test_bind_tools_with_dict(self):
        model = ChatDirectAPI(model="openai/gpt-4o")
        tool_dict = {
            "type": "function",
            "function": {"name": "hello", "parameters": {}},
        }
        bound = model.bind_tools([tool_dict])
        bound_tools = object.__getattribute__(bound, "_bound_tools")
        assert bound_tools[0] == tool_dict


# ---------------------------------------------------------------------------
# _agenerate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agenerate_calls_llm_client():
    """_agenerate should call acompletion and return ChatResult."""
    fake_response = {
        "choices": [{"message": {"content": "Hello!", "role": "assistant"}, "finish_reason": "stop"}],
        "model": "gpt-4o",
    }

    with patch("app.ai.llm_client.acompletion", new=AsyncMock(return_value=fake_response)):
        model = ChatDirectAPI(model="openai/gpt-4o", temperature=0.5)
        result = await model._agenerate([HumanMessage(content="Hi")])

    assert len(result.generations) == 1
    assert result.generations[0].message.content == "Hello!"


@pytest.mark.asyncio
async def test_agenerate_passes_tools():
    """When tools are bound, _agenerate should include them in the call."""
    fake_response = {
        "choices": [
            {
                "message": {
                    "content": "",
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": "c1",
                            "type": "function",
                            "function": {"name": "get_schema", "arguments": '{"file":"x"}'},
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
        "model": "gpt-4o",
    }

    captured_kwargs = {}

    async def capture_acompletion(**kwargs):
        captured_kwargs.update(kwargs)
        return fake_response

    @tool
    def get_schema(file: str) -> str:
        """Get file schema."""
        return ""

    with patch("app.ai.llm_client.acompletion", side_effect=capture_acompletion):
        model = ChatDirectAPI(model="openai/gpt-4o")
        bound = model.bind_tools([get_schema])
        result = await bound._agenerate([HumanMessage(content="show schema")])

    assert "tools" in captured_kwargs
    assert captured_kwargs["tools"][0]["function"]["name"] == "get_schema"
    assert result.generations[0].message.tool_calls[0]["name"] == "get_schema"


# ---------------------------------------------------------------------------
# LangGraph integration (compile-only, no LLM call)
# ---------------------------------------------------------------------------


def test_create_agent_compiles():
    """create_agent() should compile with ChatDirectAPI without errors."""
    from langchain.agents import create_agent

    @tool
    def dummy(x: str) -> str:
        """A dummy tool."""
        return x

    model = ChatDirectAPI(model="openai/gpt-4o")
    agent = create_agent(model, [dummy], system_prompt="Test agent")
    assert agent is not None
    # Should have astream method for node-level streaming
    assert callable(getattr(agent, "astream", None))


@pytest.mark.asyncio
async def test_llm_type():
    """_llm_type property should return a string."""
    model = ChatDirectAPI(model="openai/gpt-4o")
    assert model._llm_type == "direct-api"
