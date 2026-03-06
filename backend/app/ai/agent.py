"""LangGraph ReAct agent for chat (Cmd+L)."""

import json
from typing import Annotated, Any, AsyncGenerator

from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from litellm import acompletion

from app.ai.tools import get_schema, sample_data, execute_query
from app.workspace import get_schema as ws_get_schema

from typing import TypedDict


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    active_files: list[str]
    workspace_root: str


ALL_TOOLS = [get_schema, sample_data, execute_query]

TOOL_MAP = {t.name: t for t in ALL_TOOLS}


def _build_tool_schemas() -> list[dict]:
    """Convert LangChain tools to litellm/OpenAI function format."""
    schemas = []
    for t in ALL_TOOLS:
        schema = {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.args_schema.model_json_schema() if t.args_schema else {"type": "object", "properties": {}},
            },
        }
        schemas.append(schema)
    return schemas


TOOL_SCHEMAS = _build_tool_schemas()


async def agent_node(state: AgentState, model_name: str = "anthropic/claude-sonnet-4-6") -> dict:
    """Call the LLM with tool definitions."""
    # Build system message with schema context
    schema_parts = []
    for filename in state.get("active_files", []):
        try:
            cols = ws_get_schema(filename)
            col_str = ", ".join(f"{c['name']} ({c['type']})" for c in cols)
            schema_parts.append(f"File: {filename} | Columns: {col_str}")
        except Exception:
            pass

    system_msg = (
        "You are a helpful DuckDB SQL assistant. "
        "You have access to tools for inspecting file schemas, sampling data, and executing queries. "
        "Use these tools to answer the user's questions about their data files.\n\n"
    )
    if schema_parts:
        system_msg += "Available files and schemas:\n" + "\n".join(schema_parts)

    messages = [{"role": "system", "content": system_msg}]
    for msg in state["messages"]:
        if isinstance(msg, HumanMessage):
            messages.append({"role": "user", "content": msg.content})
        elif isinstance(msg, AIMessage):
            entry: dict[str, Any] = {"role": "assistant", "content": msg.content or ""}
            if msg.tool_calls:
                entry["tool_calls"] = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": json.dumps(tc["args"]),
                        },
                    }
                    for tc in msg.tool_calls
                ]
            messages.append(entry)
        elif isinstance(msg, ToolMessage):
            messages.append({
                "role": "tool",
                "tool_call_id": msg.tool_call_id,
                "content": msg.content,
            })

    response = await acompletion(
        model=model_name,
        messages=messages,
        tools=TOOL_SCHEMAS if TOOL_SCHEMAS else None,
        temperature=0.0,
    )

    choice = response.choices[0].message

    # Convert to LangChain message
    tool_calls = []
    if choice.tool_calls:
        for tc in choice.tool_calls:
            tool_calls.append({
                "id": tc.id,
                "name": tc.function.name,
                "args": json.loads(tc.function.arguments) if tc.function.arguments else {},
            })

    ai_msg = AIMessage(content=choice.content or "", tool_calls=tool_calls)
    return {"messages": [ai_msg]}


def should_continue(state: AgentState) -> str:
    """Decide whether to call tools or end."""
    last_msg = state["messages"][-1]
    if isinstance(last_msg, AIMessage) and last_msg.tool_calls:
        return "tools"
    return "end"


def create_agent(model_name: str = "anthropic/claude-sonnet-4-6", active_files: list[str] | None = None):
    """Build and compile the agent graph."""
    import functools

    bound_agent = functools.partial(agent_node, model_name=model_name)

    tool_node = ToolNode(ALL_TOOLS)

    graph = StateGraph(AgentState)
    graph.add_node("agent", bound_agent)
    graph.add_node("tools", tool_node)

    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", "end": END})
    graph.add_edge("tools", "agent")

    return graph.compile()


async def run_agent_stream(
    user_message: str,
    active_files: list[str],
    workspace_root: str = "",
    model_name: str = "anthropic/claude-sonnet-4-6",
    history: list | None = None,
) -> AsyncGenerator[dict, None]:
    """Stream agent events as dicts for SSE."""
    agent = create_agent(model_name=model_name, active_files=active_files)

    messages = list(history or [])
    messages.append(HumanMessage(content=user_message))

    state = {
        "messages": messages,
        "active_files": active_files,
        "workspace_root": workspace_root,
    }

    try:
        async for event in agent.astream_events(state, version="v2"):
            kind = event.get("event")
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content") and chunk.content:
                    yield {"type": "token", "content": chunk.content}
            elif kind == "on_tool_start":
                tool_name = event.get("name", "unknown")
                yield {"type": "tool_call", "tool": tool_name, "status": "start"}
            elif kind == "on_tool_end":
                tool_name = event.get("name", "unknown")
                yield {"type": "tool_call", "tool": tool_name, "status": "end"}

        yield {"type": "done"}
    except Exception as e:
        yield {"type": "error", "message": str(e)}
