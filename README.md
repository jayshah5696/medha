<div align="center">

<img src="docs/brand/icon.svg" alt="Medha" width="80" height="80" />

# medha

**Local-first SQL IDE for flat files. Zero setup. AI-native.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/python-3.11+-blue.svg)](https://python.org)
[![uv](https://img.shields.io/badge/uv-managed-8A2BE2)](https://astral.sh/uv)
[![Tests](https://img.shields.io/badge/tests-300%20passing-brightgreen)]()

Query Parquet, CSV, and JSON with native DuckDB speed.
`Cmd+K` to rewrite SQL inline. `Cmd+L` to explore conversationally.
Your data never leaves your machine.

[**Quickstart**](#quickstart) · [**Desktop App**](#desktop-app) · [**Key bindings**](#key-bindings) · [**Architecture**](#architecture)

</div>

---

## Why Medha

- **No server.** DuckDB runs in-process. Open a folder, start querying.
- **No egress.** The LLM sees your column names and types. Never your rows.
- **No lock-in.** Switch between OpenAI, Anthropic, OpenRouter, or a local model in settings.
- **No ceremony.** `just dev`, pick a folder, write SQL.

---

## Features

| Feature | Description |
|---------|-------------|
| **Native DuckDB** | Reads Parquet, CSV, JSON, JSONL directly. No import step. |
| **Cmd+K inline edit** | Select SQL, describe a change, see a red/green diff, accept or reject. |
| **Cmd+L chat agent** | Conversational data exploration with tool-calling agent. |
| **Multi-tab SQL editor** | Multiple editor tabs with save/close/rename (Cmd+T, Cmd+W, Cmd+S). |
| **Virtualized result grid** | 10k+ rows with row virtualization, infinite scroll, horizontal sync. |
| **SQL history** | Every query auto-saved to disk as `.sql` with metadata header. |
| **Chat threads** | Conversations persist across sessions. LLM-generated slug names. |
| **Dark & light themes** | Full token-based theme system with self-hosted fonts. |
| **Electron desktop app** | Standalone macOS app with native folder picker. |
| **CSV/Parquet export** | Export query results directly from the status bar. |
| **Zero egress** | Schema only. No row data ever leaves unless you approve a sample. |
| **LLM agnostic** | litellm routing. OpenAI, Anthropic, OpenRouter, LM Studio, Ollama. |

---

## Quickstart

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.11+ | [python.org](https://python.org) |
| uv | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| just | latest | `curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh \| bash -s -- --to ~/.local/bin` |

### Install and run

```bash
git clone https://github.com/jayshah5696/medha
cd medha

just install   # installs backend (uv sync) + frontend (npm install)
just dev       # starts backend :18900 + frontend :5173
```

Open [http://localhost:5173](http://localhost:5173), set your workspace directory, and start querying.

### Configure your LLM

Click the gear icon (top-right) and enter your API key:

```
OpenAI:      sk-...
Anthropic:   sk-ant-...
OpenRouter:  sk-or-...
LM Studio:   http://localhost:1234/v1  (no key needed)
```

Or set environment variables before `just dev`:

```bash
export OPENAI_API_KEY=sk-...
```

---

## Desktop App

Medha ships as a standalone Electron app with a bundled Python backend.

### Dev mode (3-in-1)

```bash
just dev-desktop   # starts backend + frontend + electron window
```

### Build for distribution

```bash
cd backend && uv run pyinstaller medha.spec   # bundle Python backend
cd ..
just build-frontend                            # build Vite static
npx tsc -p electron/tsconfig.json              # compile Electron TS
npx electron-builder --mac --dir               # package .app
bash scripts/sign-app.sh release/mac-arm64/Medha.app  # sign for local use
```

The Electron shell uses a local HTTP proxy so the frontend needs zero URL changes between web and desktop mode.

---

## Key Bindings

| Binding | Action |
|---------|--------|
| `Cmd+Enter` | Execute SQL in editor |
| `Cmd+K` | Inline AI edit (select SQL first, or place cursor) |
| `Cmd+L` | Open chat sidebar |
| `Cmd+H` | Open query history |
| `Cmd+T` | New editor tab |
| `Cmd+W` | Close editor tab |
| `Cmd+S` | Save current query |

---

## Agent Profiles

Agent behavior is defined in `backend/agents/*.yaml`:

| Profile | Model | Iterations | Best for |
|---------|-------|-----------|---------|
| `default` | gpt-4o-mini | 10 | General data exploration |
| `fast` | gpt-4o-mini | 5 | Simple lookups and counts |
| `deep` | claude-sonnet-4.6 | 15 | Complex multi-step analysis |

Add a custom profile by creating a YAML file in `backend/agents/`.

---

## Architecture

```
Frontend (Vite + React + TS)    Backend (FastAPI + Python)
  SqlEditor (CodeMirror 6)        /api/db/query → DuckDB
  ResultGrid (virtualized)        /api/ai/inline → litellm
  ChatSidebar (SSE stream)        /api/ai/chat → LangChain agent
  FileExplorer + History          /api/workspace → file scanner
  SettingsModal                   /api/settings → ~/.medha/

Electron shell (optional)
  Local proxy (frontend + API on one port)
  Python sidecar (PyInstaller binary)
  Native folder picker via IPC
```

**Data flow:** Schema-only goes to the LLM. Query results stay local. Chat threads and history persist to `~/.medha/`.

---

## Development

```bash
just --list         # show all recipes
just dev            # start backend + frontend
just test           # backend pytest (210 tests)
just test-frontend  # frontend vitest (93 tests)
just test-all       # both
just typecheck      # TypeScript tsc --noEmit
just ci             # full: install + test + build + typecheck
just electron-dev   # electron window (run `just dev` first)
just dev-desktop    # all three in one command
```

---

## Project Structure

```
medha/
  backend/
    app/
      main.py          FastAPI entry, lifespan, CORS
      db.py            DuckDB manager (async lock, path-safe, auto-LIMIT)
      workspace.py     File scanner, schema cache, file watcher
      ai/
        inline.py      Cmd+K single-turn litellm call
        tools.py       LangChain tools: get_schema, sample_data, execute_query
        agent.py       ReAct agent loaded from YAML profile
      routers/         workspace, db, ai, history, chats, events, models, queries
    agents/            default.yaml, fast.yaml, deep.yaml
    medha.spec         PyInstaller spec for sidecar binary
    tests/             210 tests

  frontend/
    src/
      components/      FileExplorer, SqlEditor, ResultGrid, ChatSidebar, etc.
      lib/api.ts       Typed fetch wrappers
      store.ts         Zustand global state
    tests/             93 tests

  electron/
    main.ts            Window, proxy server, sidecar lifecycle, menu
    sidecar.ts         Backend spawn, health check, shutdown
    preload.ts         contextBridge API (pickDirectory, getPort)
    port.ts            Free port finder (18900-18999)

  justfile             Task runner recipes
  SPEC.md              Full architecture specification
```

---

## Security

- Workspace sandboxed: queries cannot path-traverse outside it
- SQL blocklist: COPY, EXPORT, INSTALL, LOAD, ATTACH, CREATE TABLE blocked
- API keys masked in GET responses, never returned in plaintext
- Result rows capped at 10,000
- Only column names and types go to the LLM
- Electron: sandbox enabled, CSP headers, navigation guards

---

## License

MIT
