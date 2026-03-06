"""Dynamic model listing endpoint (SPEC §13).

Fetches available models from each provider at request time, so the UI
always shows the latest models without hardcoded lists.
"""

import httpx
from fastapi import APIRouter
from app.routers.workspace import load_settings

router = APIRouter()

# Anthropic has no public models endpoint — return known current models
ANTHROPIC_MODELS = [
    "anthropic/claude-3-7-sonnet-20250219",
    "anthropic/claude-3-5-sonnet-20241022",
    "anthropic/claude-3-5-haiku-20241022",
    "anthropic/claude-3-opus-20240229",
]


async def _fetch_json(url: str, headers: dict | None = None, timeout: float = 8.0) -> dict | list | None:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, headers=headers or {})
            resp.raise_for_status()
            return resp.json()
    except Exception:
        return None


@router.get("/api/models")
async def list_models(provider: str = "openai"):
    """
    Returns a list of model IDs for the given provider.

    Query param:
        provider: openai | anthropic | openrouter | gemini | lm_studio | ollama
    """
    settings = load_settings()
    provider = provider.lower().strip()

    if provider == "openai":
        api_key = settings.openai_api_key
        if not api_key:
            return {"error": "No OpenAI API key configured", "models": []}
        data = await _fetch_json(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if not data:
            return {"error": "Could not reach OpenAI — enter model manually", "models": []}
        # Filter to chat-capable models and sort by id descending (newest first)
        models = sorted(
            [
                f"openai/{m['id']}"
                for m in data.get("data", [])
                if any(prefix in m["id"] for prefix in ("gpt-4", "gpt-3.5", "o1", "o3", "o4"))
            ],
            reverse=True,
        )
        return {"models": models}

    elif provider == "anthropic":
        return {"models": ANTHROPIC_MODELS}

    elif provider == "openrouter":
        data = await _fetch_json("https://openrouter.ai/api/v1/models")
        if not data:
            return {"error": "Could not reach OpenRouter — enter model manually", "models": []}
        models = [f"openrouter/{m['id']}" for m in data.get("data", [])]
        return {"models": sorted(models)}

    elif provider == "gemini":
        api_key = settings.gemini_api_key
        if not api_key:
            return {"error": "No Gemini API key configured", "models": []}
        data = await _fetch_json(
            f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
        )
        if not data:
            return {"error": "Could not reach Gemini — enter model manually", "models": []}
        models = [
            f"gemini/{m['name'].split('/')[-1]}"
            for m in data.get("models", [])
            if "generateContent" in m.get("supportedGenerationMethods", [])
        ]
        return {"models": sorted(models, reverse=True)}

    elif provider == "lm_studio":
        base_url = settings.lm_studio_url.rstrip("/")
        data = await _fetch_json(f"{base_url}/models")
        if not data:
            return {"error": f"Could not reach LM Studio at {base_url} — is it running?", "models": []}
        models = [f"lm_studio/{m['id']}" for m in data.get("data", [])]
        return {"models": models}

    elif provider == "ollama":
        base_url = settings.ollama_url.rstrip("/")
        data = await _fetch_json(f"{base_url}/api/tags")
        if not data:
            return {"error": f"Could not reach Ollama at {base_url} — is it running?", "models": []}
        models = [f"ollama/{m['name']}" for m in data.get("models", [])]
        return {"models": models}

    else:
        return {"error": f"Unknown provider: {provider}", "models": []}
