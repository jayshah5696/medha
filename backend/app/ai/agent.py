"""LangChain tool-calling agent loaded from YAML config."""

from pathlib import Path
from typing import AsyncGenerator

import yaml
from langchain.agents import create_agent
from langchain_litellm import ChatLiteLLM
from langchain_core.messages import HumanMessage, AIMessage
from app.ai.tools import get_schema, sample_data, execute_query

AGENTS_DIR = Path(__file__).parent.parent.parent / "agents"


def load_agent_config(profile: str = "default") -> dict:
    """Load agent YAML config. Hot-reloadable."""
    path = AGENTS_DIR / f"{profile}.yaml"
    if not path.exists():
        path = AGENTS_DIR / "default.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def build_agent(profile: str = "default", model_override: str | None = None):
    """Build a compiled agent graph from YAML config."""
    config = load_agent_config(profile)
    model_name = model_override or config["model"]

    llm = ChatLiteLLM(model=model_name, temperature=config.get("temperature", 0))
    tools = [get_schema, sample_data, execute_query]

    agent = create_agent(
        llm,
        tools,
        system_prompt=config["system_prompt"],
    )
    return agent


async def stream_agent_response(
    message: str,
    chat_history: list,
    profile: str = "default",
    model_override: str | None = None,
) -> AsyncGenerator[str, None]:
    """Async generator yielding SSE-formatted chunks."""
    agent = build_agent(profile, model_override)

    history = []
    for msg in chat_history:
        if msg["role"] == "user":
            history.append(HumanMessage(content=msg["content"]))
        elif msg["role"] == "assistant":
            history.append(AIMessage(content=msg["content"]))

    input_data = {
        "messages": history + [HumanMessage(content=message)],
    }

    try:
        async for event in agent.astream_events(
            input_data,
            version="v2",
        ):
            kind = event["event"]
            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"].content
                if chunk:
                    yield f'data: {{"type": "token", "content": {repr(chunk)}}}\n\n'
            elif kind == "on_tool_start":
                tool_name = event["name"]
                yield f'data: {{"type": "tool_call", "tool": "{tool_name}", "status": "start"}}\n\n'
            elif kind == "on_tool_end":
                tool_name = event["name"]
                yield f'data: {{"type": "tool_call", "tool": "{tool_name}", "status": "end"}}\n\n'
        yield 'data: {"type": "done"}\n\n'
    except Exception as e:
        yield f'data: {{"type": "error", "message": "{str(e)}"}}\n\n'


# Legacy function for backward compatibility with existing router/tests
async def run_agent_stream(
    user_message: str,
    active_files: list[str],
    workspace_root: str = "",
    model_name: str = "openai/gpt-4o-mini",
    history: list | None = None,
) -> AsyncGenerator[dict, None]:
    """Stream agent events as dicts for SSE. Legacy compatibility wrapper."""
    agent = build_agent(model_override=model_name)

    messages = list(history or [])
    messages.append(HumanMessage(content=user_message))

    input_data = {"messages": messages}

    try:
        async for event in agent.astream_events(input_data, version="v2"):
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
