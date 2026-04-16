# Replacing litellm: Research & Plan

**Date:** 2026-04-16  
**Status:** Research complete, ready for implementation spike  
**Goal:** Remove litellm (65 MB installed, 733 modules, 11 MB in bundle) and replace with direct OpenAI-compatible API calls

---

## Why Remove litellm?

| Metric | With litellm | Without |
|--------|-------------|---------|
| Installed size | 65 MB | 0 |
| Bundle size (sidecar) | 11 MB | 0 |
| Transitive deps | tokenizers (8.4 MB), tiktoken (3.1 MB), openai SDK (9.6 MB), cryptography (21 MB), numpy (23 MB in venv) | httpx (already bundled) |
| Modules loaded | 733 | ~5 (our own module) |
| Import time | ~1.8s | ~0.01s |

**We use exactly 2 functions from a 733-module library:**
1. `litellm.acompletion()` — in `chats.py` for slug generation and `inline.py` for Cmd+K
2. `ChatLiteLLM()` — in `agent.py` as the LangGraph LLM wrapper

---

## The Key Insight: OpenAI-Compatible Endpoints

Every major LLM provider now supports the OpenAI chat completions format:

| Provider | Base URL | Notes |
|----------|----------|-------|
| OpenAI | `https://api.openai.com/v1` | Native |
| OpenRouter | `https://openrouter.ai/api/v1` | Aggregator, same format |
| Anthropic | `https://api.anthropic.com/v1` | Via their OpenAI-compatible endpoint |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI-compatible mode |
| Local (Ollama) | `http://localhost:11434/v1` | Native OpenAI format |
| Local (LM Studio) | `http://localhost:1234/v1` | Native OpenAI format |
| Azure OpenAI | `https://{name}.openai.azure.com/openai/deployments/{model}/` | With API version param |

**This means one HTTP client can talk to all of them.** litellm's main value (routing to different providers) becomes unnecessary when they all speak the same protocol.

---

## Architecture: What Replaces litellm

### Layer 1: `app/ai/llm_client.py` — Direct OpenAI-compatible HTTP client

```python
"""Thin async client for OpenAI-compatible chat completions.

Replaces litellm. Uses httpx (already bundled) to call any
OpenAI-compatible endpoint. ~100 lines instead of 733 modules.
"""

import httpx
from typing import AsyncGenerator

_client: httpx.AsyncClient | None = None

def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=60.0)
    return _client


def _parse_model_string(model: str) -> tuple[str, str, str]:
    """Parse 'provider/model-name' into (base_url, api_key_env, model_name).
    
    Examples:
        'openai/gpt-4o'          -> ('https://api.openai.com/v1', 'OPENAI_API_KEY', 'gpt-4o')
        'openrouter/anthropic/...' -> ('https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 'anthropic/...')
        'gemini/gemini-2.5-flash' -> ('https://generativelanguage.googleapis.com/v1beta/openai', 'GEMINI_API_KEY', 'gemini-2.5-flash')
        'ollama/llama3'          -> ('http://localhost:11434/v1', None, 'llama3')
    """
    # Provider routing table — the ONLY thing litellm gave us that we need
    ...


async def acompletion(
    model: str,
    messages: list[dict],
    temperature: float = 0.0,
    max_tokens: int | None = None,
    stream: bool = False,
) -> dict | AsyncGenerator[dict, None]:
    """Drop-in replacement for litellm.acompletion().
    
    POST /chat/completions to the resolved base_url.
    Returns the same shape as OpenAI's response.
    """
    base_url, api_key_env, model_name = _parse_model_string(model)
    api_key = os.environ.get(api_key_env, "")
    
    client = _get_client()
    
    if stream:
        # SSE streaming via httpx
        ...
    else:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model_name,
                "messages": messages,
                "temperature": temperature,
                **({"max_tokens": max_tokens} if max_tokens else {}),
            },
        )
        resp.raise_for_status()
        return resp.json()
```

### Layer 2: `app/ai/chat_model.py` — LangChain BaseChatModel for LangGraph

```python
"""LangChain-compatible chat model using our direct HTTP client.

Replaces ChatLiteLLM. Implements BaseChatModel so LangGraph's
create_agent() can use it with tool calling.
"""

from langchain_core.language_models.chat_models import BaseChatModel

class ChatDirectAPI(BaseChatModel):
    """Chat model that calls OpenAI-compatible endpoints directly."""
    
    model: str = "openai/gpt-4o-mini"
    temperature: float = 0.0
    
    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        # Sync wrapper — convert messages to OpenAI format, call acompletion
        ...
    
    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        # Async — used by LangGraph's astream()
        from app.ai.llm_client import acompletion
        ...
    
    def _llm_type(self) -> str:
        return "direct-api"
```

### Layer 3: Update imports

```python
# agent.py: change one line
# Before:
from langchain_litellm import ChatLiteLLM
llm = ChatLiteLLM(model=model_name, temperature=0)

# After:
from app.ai.chat_model import ChatDirectAPI
llm = ChatDirectAPI(model=model_name, temperature=0)

# inline.py: change one import
# Before:
from litellm import acompletion

# After:
from app.ai.llm_client import acompletion
```

---

## What We Lose

| Feature | litellm | Our replacement | Impact |
|---------|---------|-----------------|--------|
| Provider routing | 100+ providers | 6 providers (table above) | Low — we only use ~4 |
| Cost tracking | Per-token cost logging | None | Low — local-first app, users track their own costs |
| Automatic retries | Configurable retry with backoff | Simple 1-retry in httpx | Low |
| Model aliases | `gpt-4o` → latest snapshot | Pass through to provider | None — providers handle this |
| Fallback models | Route to backup on failure | Not built-in | Can add later if needed |
| Token counting | tiktoken/tokenizers integration | Remove — not used in app | None |
| Streaming format | Unified SSE parsing | We parse SSE ourselves (~20 lines) | Low effort |

**Key question:** Does LangGraph's `create_agent()` require tool-calling format that varies by provider?

**Answer:** No. LangGraph calls `_agenerate()` on the chat model and expects OpenAI-format tool calls in the response. Since all providers now return OpenAI-format tool calls, our `ChatDirectAPI` just passes them through.

---

## Dependencies Removed

If litellm is removed from `pyproject.toml`, these transitive deps also go away:

| Package | Size (venv) | Size (bundle) | Notes |
|---------|-------------|---------------|-------|
| litellm | 65 MB | 11 MB | The library itself |
| tokenizers | 8.4 MB | 7.9 MB | HuggingFace tokenizer, only used by litellm |
| tiktoken | 3.1 MB | 2.6 MB | OpenAI tokenizer, only used by litellm |
| openai SDK | 9.6 MB | ~2 MB | litellm wraps this; we'd use httpx directly |
| numpy | 23 MB | excluded | tokenizers dep |
| langchain-litellm | 155 KB | ~100 KB | Replaced by our ChatDirectAPI |
| **Total** | **~109 MB** | **~24 MB** | |

**Projected sidecar:** 124 MB → ~100 MB  
**Projected venv:** 305 MB → ~196 MB

---

## Implementation Plan

### Phase 1: Spike (1 day)
1. Create `app/ai/llm_client.py` with `acompletion()` for OpenAI/OpenRouter
2. Create `app/ai/chat_model.py` with `ChatDirectAPI` 
3. Wire into `inline.py` and `agent.py`
4. Test with OpenAI and OpenRouter (most common user setup)
5. Measure: does the agent still work with tool calling? Does streaming work?

### Phase 2: Full Implementation (1 day)
1. Add Gemini, Ollama, LM Studio provider routing
2. Add streaming SSE parsing for chat responses
3. Add proper error handling (auth errors, rate limits, connection failures)
4. Add settings UI for custom base_url (advanced users)
5. Remove litellm, langchain-litellm from `pyproject.toml`
6. Update `medha.spec` to remove litellm excludes/includes
7. Update all tests

### Phase 3: Verify & Release
1. Run full test suite
2. Build sidecar, measure size
3. Test with all 4 providers (OpenAI, OpenRouter, Gemini, Ollama)
4. Release as v0.5.0

---

## Settings UI Impact

Current settings store API keys per provider. This doesn't change. We add one optional field:

```
Custom API Base URL: [____________________________]
(For self-hosted or enterprise endpoints)
```

The provider is determined by the model string prefix: `openai/`, `openrouter/`, `gemini/`, `ollama/`, or `custom/`.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Tool calling format differs between providers | Low — all use OpenAI format now | Test with each provider explicitly |
| Streaming SSE parsing edge cases | Medium | Use httpx's built-in SSE support or `httpx-sse` (tiny dep) |
| Provider-specific auth headers | Low | Each provider documents this clearly |
| Users on exotic providers we don't support | Low | Add `custom/` prefix that takes any base_url |
| LangGraph internal changes break ChatDirectAPI | Low | We implement BaseChatModel, the stable interface |

---

## Decision

**Recommendation: Do the 1-day spike.** If the spike confirms tool calling works through our thin client, proceed with full implementation. The savings (24 MB disk, 80+ MB RAM, 700+ fewer modules) are significant and the replacement is straightforward because all providers now speak OpenAI format.

If the spike reveals complications (e.g., Anthropic's tool calling has quirks our thin client can't handle), we keep litellm but know exactly why.
