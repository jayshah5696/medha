# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for medha-backend (FastAPI + DuckDB + LangGraph + litellm).

Build with:
    cd backend && pyinstaller medha.spec

Produces:  dist/medha-backend/  (--onedir mode for fast startup as Electron sidecar)

The binary reads MEDHA_PORT from environment (default 18900).
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
# Many of these libraries use lazy imports, entry_points, or importlib that
# PyInstaller's static analysis cannot detect.

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

    # --- DuckDB ---
    "duckdb",

    # --- PyArrow (has many compiled C++ extensions loaded dynamically) ---
    "pyarrow",
    "pyarrow.ipc",
    "pyarrow.lib",
    "pyarrow.pandas_compat",
    "pyarrow.vendored",
    "pyarrow.vendored.version",

    # --- Pandas ---
    "pandas",
    "pandas.io.formats.style",
    "pandas._libs.tslibs.timedeltas",
    "pandas._libs.tslibs.nattype",
    "pandas._libs.tslibs.np_datetime",

    # --- watchfiles (Rust-based, needs the compiled extension) ---
    "watchfiles",
    "watchfiles._rust_notify",
    "watchfiles.main",

    # --- litellm (many provider modules loaded dynamically) ---
    "litellm",
    "litellm.llms",
    "litellm.llms.openai",
    "litellm.llms.anthropic",
    "litellm.llms.openai_like",
    "litellm.main",
    "litellm.utils",
    "litellm.cost_calculator",
    "litellm.router",
    "litellm.proxy",

    # --- LangChain ecosystem ---
    "langchain",
    "langchain.agents",
    "langchain.chains",
    "langchain.schema",
    "langchain.tools",
    "langchain_core",
    "langchain_core.callbacks",
    "langchain_core.callbacks.manager",
    "langchain_core.language_models",
    "langchain_core.messages",
    "langchain_core.output_parsers",
    "langchain_core.prompts",
    "langchain_core.runnables",
    "langchain_core.tools",
    "langchain_community",

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

# Collect all submodules for libraries that have deep dynamic import trees.
# This is the nuclear option but necessary for litellm and langchain which
# discover providers/modules at runtime via importlib and entry_points.
hiddenimports += collect_submodules("litellm")
hiddenimports += collect_submodules("langchain")
hiddenimports += collect_submodules("langchain_core")
hiddenimports += collect_submodules("langchain_community")
hiddenimports += collect_submodules("langchain_litellm")
hiddenimports += collect_submodules("langgraph")
hiddenimports += collect_submodules("pydantic")
hiddenimports += collect_submodules("pyarrow")
hiddenimports += collect_submodules("sqlglot")

# De-duplicate
hiddenimports = list(set(hiddenimports))

# ---------------------------------------------------------------------------
# Data files
# ---------------------------------------------------------------------------
# Many packages ship data files (JSON schemas, default configs, tiktoken
# encodings, etc.) that must be bundled alongside the Python code.

datas = []

# Agent YAML configs (backend/agents/*.yaml -> agents/)
datas += [
    ("agents/*.yaml", "agents"),
]

# litellm ships model cost maps, provider configs, and proxy templates
datas += collect_data_files("litellm")

# langchain and friends ship hub prompts, schema definitions, etc.
datas += collect_data_files("langchain")
datas += collect_data_files("langchain_core")
datas += collect_data_files("langchain_community")
datas += collect_data_files("langchain_litellm")
datas += collect_data_files("langgraph")

# pydantic needs its compiled schema files
datas += collect_data_files("pydantic")
datas += collect_data_files("pydantic_core")

# pyarrow needs its shared libraries and data files
datas += collect_data_files("pyarrow")

# sqlglot ships dialect definitions
datas += collect_data_files("sqlglot")

# certifi CA bundle (needed for HTTPS to LLM APIs)
datas += collect_data_files("certifi")

# Package metadata (needed by importlib.metadata / pkg_resources lookups)
datas += copy_metadata("litellm")
datas += copy_metadata("langchain")
datas += copy_metadata("langchain-core")
datas += copy_metadata("langchain-community")
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
# DuckDB, pyarrow, and watchfiles ship compiled .so/.dylib/.pyd files.
# PyInstaller normally picks these up, but we list them explicitly to be safe.
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
        # Exclude heavy packages we definitely don't need
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
    strip=False,
    upx=True,
    console=True,  # Server process — needs stdout/stderr
    disable_windowed_traceback=False,
)

# ---------------------------------------------------------------------------
# COLLECT (--onedir output)
# ---------------------------------------------------------------------------
# Produces dist/medha-backend/ with the exe + all shared libs and data files.
# This is preferred over --onefile for Electron sidecar use because:
#   1. No temp-dir extraction on startup (faster cold start)
#   2. OS can cache shared libraries across runs
#   3. Easier to debug (files are visible on disk)
#   4. Code-signing on macOS works better with bundles

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="medha-backend",
)
