# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for medha-backend (FastAPI + DuckDB + LangGraph + litellm).

Build with:
    cd backend && pyinstaller -y medha.spec

Produces:  dist/medha-backend/  (--onedir mode for fast startup as Electron sidecar)

The binary reads MEDHA_PORT from environment (default 18900).

SIZE OPTIMIZATION (2026-04-16):
  - Removed pyarrow (200 MB) — Arrow IPC endpoint was dead code
  - Removed pandas (17 MB) — zero imports in app code
  - Excluded litellm.proxy (~20 MB) — only SDK is used
  - Replaced collect_submodules() nuclear option with explicit imports
  - Enabled strip=True on EXE and COLLECT
  - Excluded hf_xet, unnecessary transitive deps
  See docs/plans/app-size-optimization.md for full rationale.
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_submodules,
    copy_metadata,
)

block_cipher = None

# ---------------------------------------------------------------------------
# Hidden imports
# ---------------------------------------------------------------------------
# Only include modules the app actually uses. Previous spec used
# collect_submodules() on 8+ packages ("nuclear option") which bundled
# hundreds of MB of unused code.

hiddenimports = [
    # --- FastAPI / Starlette / Uvicorn ---
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "fastapi",
    "fastapi.middleware",
    "fastapi.middleware.cors",
    "starlette.responses",
    "starlette.routing",
    "starlette.middleware",
    "starlette.middleware.cors",
    "starlette.formparsers",
    "multipart",
    "multipart.multipart",

    # --- DuckDB (single .so, no submodules) ---
    "duckdb",

    # --- watchfiles (Rust-based, needs the compiled extension) ---
    "watchfiles",
    "watchfiles._rust_notify",
    "watchfiles.main",

    # --- litellm SDK (NOT proxy — only the completion/embedding API) ---
    "litellm",
    "litellm.llms",
    "litellm.llms.openai",
    "litellm.llms.anthropic",
    "litellm.llms.openai_like",
    "litellm.main",
    "litellm.utils",
    "litellm.cost_calculator",
    "litellm.router",

    # --- LangChain core (only what agent.py imports) ---
    "langchain",
    "langchain.agents",
    "langchain_core",
    "langchain_core.callbacks",
    "langchain_core.callbacks.manager",
    "langchain_core.language_models",
    "langchain_core.messages",
    "langchain_core.output_parsers",
    "langchain_core.prompts",
    "langchain_core.runnables",
    "langchain_core.tools",

    # --- langchain-litellm ---
    "langchain_litellm",
    "langchain_litellm.chat_models",

    # --- LangGraph ---
    "langgraph",
    "langgraph.graph",
    "langgraph.graph.state",
    "langgraph.prebuilt",
    "langgraph.errors",
    "langgraph.channels",
    "langgraph.managed",
    "langgraph.pregel",
    "langgraph.store",

    # --- SQLGlot ---
    "sqlglot",
    "sqlglot.dialects",
    "sqlglot.dialects.duckdb",

    # --- YAML ---
    "yaml",
    "_yaml",

    # --- dotenv ---
    "dotenv",

    # --- httpx (used by litellm for async HTTP) ---
    "httpx",
    "httpcore",
    "httpcore._async",
    "httpcore._sync",
    "h11",
    "anyio",
    "anyio._backends",
    "anyio._backends._asyncio",
    "sniffio",
    "socksio",
    "certifi",

    # --- pydantic (heavy use of compiled validators) ---
    "pydantic",
    "pydantic.deprecated",
    "pydantic.deprecated.decorator",
    "pydantic_core",
    "annotated_types",

    # --- SSE / streaming ---
    "sse_starlette",
    "sse_starlette.sse",

    # --- email/mimetypes (needed by starlette, often missed) ---
    "email.mime.multipart",
    "email.mime.text",
    "mimetypes",

    # --- App modules (ensure all routers are bundled) ---
    "app",
    "app.main",
    "app.db",
    "app.workspace",
    "app.workspace_store",
    "app.ai",
    "app.ai.agent",
    "app.ai.tools",
    "app.ai.inline",
    "app.routers",
    "app.routers.workspace",
    "app.routers.db",
    "app.routers.ai",
    "app.routers.history",
    "app.routers.chats",
    "app.routers.events",
    "app.routers.models",
    "app.routers.queries",
]

# Use collect_submodules only for packages that truly need it:
# - litellm: discovers providers at runtime via importlib, but we filter proxy
# - langchain_core: runnables use dynamic dispatch
# - pydantic: compiled validators loaded dynamically
# - langgraph: channels/managed loaded dynamically
#
# litellm discovers providers at runtime via importlib. We need
# collect_submodules but we can't fully exclude litellm.proxy because
# litellm's core logging imports proxy modules transitively.
# Instead we include the Python stubs but strip the heavy DATA FILES
# (swagger UI, prisma schemas, experimental assets) below.
hiddenimports += collect_submodules("litellm")
hiddenimports += collect_submodules("langchain_core")
hiddenimports += collect_submodules("langchain_litellm")
hiddenimports += collect_submodules("langgraph")
hiddenimports += collect_submodules("pydantic")

# De-duplicate
hiddenimports = list(set(hiddenimports))

# ---------------------------------------------------------------------------
# Data files
# ---------------------------------------------------------------------------
datas = []

# Agent YAML configs (backend/agents/*.yaml -> agents/)
datas += [
    ("agents/*.yaml", "agents"),
]

# litellm ships model cost maps and provider configs.
# We strip the heavy proxy data files (swagger UI ~1.6 MB, _experimental ~17 MB,
# guardrails, prisma schemas, logos, etc.) that the SDK never reads.
_PROXY_STRIP = {"swagger", "_experimental", "guardrails", "example_config_yaml",
                "public_endpoints", "client", "hooks", "test_prompts"}
_litellm_data = [
    (src, dst) for src, dst in collect_data_files("litellm")
    if not any(part in _PROXY_STRIP for part in Path(src).parts)
]
datas += _litellm_data

# langchain core
datas += collect_data_files("langchain")
datas += collect_data_files("langchain_core")
datas += collect_data_files("langchain_litellm")
datas += collect_data_files("langgraph")

# pydantic needs its compiled schema files
datas += collect_data_files("pydantic")
datas += collect_data_files("pydantic_core")

# sqlglot ships dialect definitions
datas += collect_data_files("sqlglot")

# certifi CA bundle (needed for HTTPS to LLM APIs)
datas += collect_data_files("certifi")

# Package metadata (needed by importlib.metadata / pkg_resources lookups)
datas += copy_metadata("litellm")
datas += copy_metadata("langchain")
datas += copy_metadata("langchain-core")
datas += copy_metadata("langchain-litellm")
datas += copy_metadata("langgraph")
datas += copy_metadata("fastapi")
datas += copy_metadata("starlette")
datas += copy_metadata("uvicorn")
datas += copy_metadata("pydantic")
datas += copy_metadata("pydantic-core")
datas += copy_metadata("httpx")
datas += copy_metadata("httpcore")
datas += copy_metadata("openai")

# ---------------------------------------------------------------------------
# Binary extensions
# ---------------------------------------------------------------------------
binaries = []

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

a = Analysis(
    ["app/main.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # -- Removed dependencies (no longer in pyproject.toml) --
        "pyarrow",
        "pandas",
        "numpy",
        # -- Heavy packages we definitely don't need --
        "tkinter",
        "matplotlib",
        "scipy",
        "sklearn",
        "notebook",
        "IPython",
        "jupyterlab",
        "pytest",
        "setuptools",
        "pip",
        "wheel",
        "_pytest",
        # -- HuggingFace transport (not needed for API-based LLM calls) --
        "hf_xet",
        # -- langchain_community (zero imports in app code) --
        "langchain_community",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# ---------------------------------------------------------------------------
# PYZ (compressed Python archive)
# ---------------------------------------------------------------------------

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# ---------------------------------------------------------------------------
# EXE
# ---------------------------------------------------------------------------

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,  # Required for --onedir (COLLECT gathers them)
    name="medha-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,   # Strip debug symbols from the executable (~10-30% size reduction)
    upx=True,
    console=True,  # Server process — needs stdout/stderr
    disable_windowed_traceback=False,
)

# ---------------------------------------------------------------------------
# COLLECT (--onedir output)
# ---------------------------------------------------------------------------

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=True,    # Strip debug symbols from all collected binaries
    upx=True,
    upx_exclude=[],
    name="medha-backend",
)
