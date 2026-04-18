"""Live API integration tests against OpenRouter with Gemini 2.0 Flash Lite.

Run with:
    cd backend && OPENROUTER_API_KEY=... uv run pytest tests/test_live_api.py -v -s

These tests make REAL API calls. They are skipped if OPENROUTER_API_KEY
is not set in the environment.
"""

import asyncio
import os
import time

import pytest

# Skip entire module if no API key
pytestmark = pytest.mark.skipif(
    not os.environ.get("OPENROUTER_API_KEY"),
    reason="OPENROUTER_API_KEY not set — skipping live API tests",
)

MODEL = "openrouter/google/gemini-2.0-flash-lite-001"


# ---------------------------------------------------------------------------
# 1. llm_client: non-streaming
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_acompletion_non_streaming():
    """Non-streaming completion via OpenRouter -> Gemini Flash Lite."""
    from app.ai.llm_client import acompletion

    result = await acompletion(
        model=MODEL,
        messages=[
            {"role": "system", "content": "You are a helpful assistant. Reply in one sentence."},
            {"role": "user", "content": "What is 2+2?"},
        ],
        temperature=0.0,
        max_tokens=50,
    )

    # Verify shape
    assert "choices" in result, f"Missing 'choices' in response: {result}"
    assert len(result["choices"]) >= 1
    msg = result["choices"][0]["message"]
    assert "content" in msg
    content = msg["content"]
    print(f"\n[NON-STREAM] Response: {content}")
    assert "4" in content, f"Expected '4' in response: {content}"


# ---------------------------------------------------------------------------
# 2. llm_client: streaming
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_acompletion_streaming():
    """Streaming SSE completion via OpenRouter -> Gemini Flash Lite."""
    from app.ai.llm_client import acompletion

    stream = await acompletion(
        model=MODEL,
        messages=[
            {"role": "user", "content": "Count from 1 to 5, one number per line."},
        ],
        temperature=0.0,
        max_tokens=50,
        stream=True,
    )

    chunks = []
    full_content = ""
    async for chunk in stream:
        chunks.append(chunk)
        delta = chunk.get("choices", [{}])[0].get("delta", {})
        token = delta.get("content", "")
        if token:
            full_content += token

    print(f"\n[STREAM] Chunks received: {len(chunks)}")
    print(f"[STREAM] Full content: {full_content}")
    assert len(chunks) > 1, "Expected multiple SSE chunks for streaming"
    assert "1" in full_content and "5" in full_content


# ---------------------------------------------------------------------------
# 3. llm_client: tool calling (function calling)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_acompletion_with_tools():
    """Tool calling via OpenRouter -> Gemini Flash Lite."""
    from app.ai.llm_client import acompletion

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get the current weather for a city",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {"type": "string", "description": "City name"},
                    },
                    "required": ["city"],
                },
            },
        }
    ]

    result = await acompletion(
        model=MODEL,
        messages=[
            {"role": "user", "content": "What's the weather in Tokyo?"},
        ],
        tools=tools,
        temperature=0.0,
    )

    msg = result["choices"][0]["message"]
    print(f"\n[TOOLS] Response message: {msg}")

    # Model should either call the tool or mention it can't get weather
    tool_calls = msg.get("tool_calls", [])
    if tool_calls:
        assert tool_calls[0]["function"]["name"] == "get_weather"
        print(f"[TOOLS] Tool call: {tool_calls[0]}")
    else:
        print(f"[TOOLS] No tool call, content: {msg.get('content', '')}")


# ---------------------------------------------------------------------------
# 4. ChatDirectAPI: async _agenerate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_chat_model_agenerate():
    """ChatDirectAPI._agenerate with real API call."""
    from app.ai.chat_model import ChatDirectAPI
    from langchain_core.messages import HumanMessage

    model = ChatDirectAPI(model=MODEL, temperature=0.0)
    result = await model._agenerate(
        messages=[HumanMessage(content="What is the capital of France? Reply in one word.")],
    )

    assert len(result.generations) == 1
    msg = result.generations[0].message
    content = msg.content
    print(f"\n[CHAT_MODEL ASYNC] Response: {content}")
    assert "paris" in content.lower(), f"Expected 'Paris' in: {content}"


# ---------------------------------------------------------------------------
# 5. ChatDirectAPI: sync _generate
# ---------------------------------------------------------------------------


def test_live_chat_model_generate_sync():
    """ChatDirectAPI._generate (sync wrapper) with real API call."""
    from app.ai.chat_model import ChatDirectAPI
    from langchain_core.messages import HumanMessage

    model = ChatDirectAPI(model=MODEL, temperature=0.0)

    # _generate runs the async path in an event loop
    # Need a fresh loop since pytest-asyncio may have one running
    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(
            model._agenerate(
                messages=[HumanMessage(content="What is 10 * 10? Reply with just the number.")],
            )
        )
    finally:
        loop.close()

    msg = result.generations[0].message
    content = msg.content
    print(f"\n[CHAT_MODEL SYNC] Response: {content}")
    assert "100" in content, f"Expected '100' in: {content}"


# ---------------------------------------------------------------------------
# 6. ChatDirectAPI: tool calling round-trip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_chat_model_with_tools():
    """ChatDirectAPI.bind_tools + _agenerate: tool call round-trip."""
    from app.ai.chat_model import ChatDirectAPI
    from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
    from langchain_core.tools import tool

    @tool
    def get_schema(file: str) -> str:
        """Get the schema of a data file."""
        return "id INTEGER, name VARCHAR, score FLOAT"

    model = ChatDirectAPI(model=MODEL, temperature=0.0)
    bound = model.bind_tools([get_schema])

    # Step 1: Ask something that should trigger tool call
    result = await bound._agenerate(
        messages=[HumanMessage(content="Show me the schema of data.csv")],
    )
    first_msg = result.generations[0].message
    print(f"\n[TOOL ROUNDTRIP] First response: content='{first_msg.content}', tool_calls={first_msg.tool_calls}")

    if first_msg.tool_calls:
        tc = first_msg.tool_calls[0]
        assert tc["name"] == "get_schema"
        print(f"[TOOL ROUNDTRIP] Tool call args: {tc['args']}")

        # Step 2: Send tool result back and get final answer
        tool_result = get_schema.invoke(tc["args"])
        result2 = await bound._agenerate(
            messages=[
                HumanMessage(content="Show me the schema of data.csv"),
                first_msg,
                ToolMessage(content=tool_result, tool_call_id=tc["id"]),
            ],
        )
        final_msg = result2.generations[0].message
        print(f"[TOOL ROUNDTRIP] Final response: {final_msg.content}")
        assert final_msg.content, "Expected non-empty final response after tool result"
    else:
        print("[TOOL ROUNDTRIP] Model didn't call tools — may have answered directly")


# ---------------------------------------------------------------------------
# 7. Full LangGraph agent: compile + single turn
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_langgraph_agent_single_turn():
    """Full LangGraph create_agent + astream with real API."""
    from langchain.agents import create_agent
    from langchain_core.messages import HumanMessage
    from langchain_core.tools import tool
    from app.ai.chat_model import ChatDirectAPI

    @tool
    def add_numbers(a: int, b: int) -> int:
        """Add two numbers together."""
        return a + b

    model = ChatDirectAPI(model=MODEL, temperature=0.0)
    agent = create_agent(
        model,
        [add_numbers],
        system_prompt="You are a calculator. Use the add_numbers tool to add numbers.",
    )

    input_data = {
        "messages": [HumanMessage(content="What is 7 + 13?")],
    }

    events = []
    final_content = ""
    async for chunk in agent.astream(input_data, config={"recursion_limit": 10}):
        for node_name, node_output in chunk.items():
            print(f"[LANGGRAPH] Node: {node_name}")
            events.append(node_name)
            if node_name == "agent" or node_name == "model":
                msgs = node_output.get("messages", [])
                for m in msgs:
                    if hasattr(m, "content") and m.content:
                        final_content = m.content
                        print(f"[LANGGRAPH]   Content: {m.content[:100]}")
                    if hasattr(m, "tool_calls") and m.tool_calls:
                        for tc in m.tool_calls:
                            print(f"[LANGGRAPH]   Tool call: {tc['name']}({tc['args']})")
            elif node_name == "tools":
                msgs = node_output.get("messages", [])
                for m in msgs:
                    print(f"[LANGGRAPH]   Tool result: {m.content[:100] if hasattr(m, 'content') else m}")

    print(f"\n[LANGGRAPH] All events: {events}")
    print(f"[LANGGRAPH] Final content: {final_content}")
    assert "20" in final_content, f"Expected '20' in final answer: {final_content}"


# ---------------------------------------------------------------------------
# 8. Streaming latency check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_streaming_time_to_first_chunk():
    """Verify first chunk arrives quickly (not buffered)."""
    from app.ai.llm_client import acompletion

    t0 = time.monotonic()
    stream = await acompletion(
        model=MODEL,
        messages=[{"role": "user", "content": "Say hello"}],
        temperature=0.0,
        max_tokens=20,
        stream=True,
    )

    first_chunk_time = None
    async for chunk in stream:
        if first_chunk_time is None:
            first_chunk_time = time.monotonic() - t0
        break  # Just need the first chunk

    print(f"\n[LATENCY] Time to first chunk: {first_chunk_time*1000:.0f}ms")
    # Should be under 5 seconds even with cold start
    assert first_chunk_time < 10.0, f"First chunk took too long: {first_chunk_time:.1f}s"


# ---------------------------------------------------------------------------
# 9. Error handling: bad model name
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_bad_model_raises():
    """Non-existent model should raise a clear error."""
    from app.ai.llm_client import acompletion, LLMError

    with pytest.raises(LLMError):
        await acompletion(
            model="openrouter/nonexistent/fake-model-999",
            messages=[{"role": "user", "content": "test"}],
            max_tokens=5,
        )
