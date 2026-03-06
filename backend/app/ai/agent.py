"""LangChain tool-calling agent loaded from YAML config."""

import re
from pathlib import Path
from typing import AsyncGenerator

import yaml
from langchain.agents import create_agent
from langchain_litellm import ChatLiteLLM
from langchain_core.messages import HumanMessage, AIMessage
from app.ai.tools import get_schema, sample_data, execute_query

AGENTS_DIR = Path(__file__).parent.parent.parent / "agents"

# Module-level agent cache. Keyed by "profile:model_override".
# Each entry stores (compiled_agent, yaml_mtime) so the agent is
# rebuilt automatically when the YAML file changes on disk.
_agent_cache: dict[str, tuple[object, float]] = {}

_SAFE_PROFILE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _validate_profile(profile: str) -> str:
    """SEC-2: prevent path traversal in profile names."""
    if not _SAFE_PROFILE.match(profile):
        raise ValueError(f"Invalid profile name: {profile!r}")
    return profile


def load_agent_config(profile: str = "default") -> dict:
    """Load agent YAML config. Hot-reloadable."""
    profile = _validate_profile(profile)
    path = AGENTS_DIR / f"{profile}.yaml"
    if not path.exists():
        path = AGENTS_DIR / "default.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def _build_executor(profile: str = "default", model_override: str | None = None):
    """Build a compiled agent graph from YAML config (uncached).

    Uses LangGraph's create_agent which accepts system_prompt directly
    and returns a compiled StateGraph with astream_events support.
    We pass a ChatLiteLLM instance so LangGraph doesn't try to
    resolve the model string via init_chat_model (which requires
    provider-specific packages like langchain-openai).
    """
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


def build_agent(profile: str = "default", model_override: str | None = None):
    """Build or return a cached agent graph.

    The cache is keyed by profile + model override. If the underlying
    YAML file has been modified since the last build, the agent is
    rebuilt so config changes take effect without a server restart.
    """
    profile = _validate_profile(profile)
    cache_key = f"{profile}:{model_override}"
    yaml_path = AGENTS_DIR / f"{profile}.yaml"
    if not yaml_path.exists():
        yaml_path = AGENTS_DIR / "default.yaml"

    mtime = yaml_path.stat().st_mtime if yaml_path.exists() else 0

    if cache_key in _agent_cache:
        cached_agent, cached_mtime = _agent_cache[cache_key]
        if cached_mtime == mtime:
            return cached_agent

    agent = _build_executor(profile, model_override)
    _agent_cache[cache_key] = (agent, mtime)
    return agent


async def stream_agent_response(
    message: str,
    chat_history: list,
    active_files: list[str] | None = None,
    profile: str = "default",
    model_override: str | None = None,
) -> AsyncGenerator[dict, None]:
    """Async generator yielding typed dicts.

    BUG-11 fix: SSE formatting now belongs to the router layer.
    This function only yields raw dicts like {"type": "token", "content": ...}.

    Uses agent.astream() which yields node-level updates. ChatLiteLLM
    does not support per-token streaming via astream_events, so we
    deliver the full response from each 'model' node output.
    """
    agent = build_agent(profile, model_override)
    config = load_agent_config(profile)
    max_iterations = config.get("max_iterations", 15)

    history = []
    for msg in chat_history:
        if msg["role"] == "user":
            history.append(HumanMessage(content=msg["content"]))
        elif msg["role"] == "assistant":
            history.append(AIMessage(content=msg["content"]))

    # Inject active files context into the user message so the LLM
    # knows which files are currently selected in the workspace.
    augmented_message = message
    if active_files:
        files_list = ", ".join(f"'{f}'" for f in active_files)
        augmented_message = (
            f"[Active files in workspace: {files_list}]\n\n{message}"
        )

    input_data = {
        "messages": history + [HumanMessage(content=augmented_message)],
    }

    try:
        async for chunk in agent.astream(input_data, config={"recursion_limit": max_iterations}):
            # Each chunk is a dict keyed by the node name that just finished.
            # The 'model' node produces {"messages": [AIMessage(...)]}
            # The 'tools' node produces {"messages": [ToolMessage(...)]}
            for node_name, node_output in chunk.items():
                if node_name == "model":
                    msgs = node_output.get("messages", [])
                    for msg in msgs:
                        if hasattr(msg, "content") and msg.content:
                            yield {"type": "token", "content": msg.content}
                        # Report tool calls if the model decided to call tools
                        if hasattr(msg, "tool_calls") and msg.tool_calls:
                            for tc in msg.tool_calls:
                                yield {"type": "tool_call", "tool": tc["name"], "status": "start"}
                elif node_name == "tools":
                    msgs = node_output.get("messages", [])
                    for msg in msgs:
                        tool_name = getattr(msg, "name", "unknown")
                        yield {"type": "tool_call", "tool": tool_name, "status": "end"}
        yield {"type": "done"}
    except Exception as e:
        yield {"type": "error", "message": str(e)}
