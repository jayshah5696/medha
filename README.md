# Medha

> मेधा — intelligence, mental power. A local-first SQL IDE for querying flat files with AI.

Query Parquet, CSV, and JSON files at native DuckDB speed. AI SQL generation inline (Cmd+K) and conversational data exploration (Cmd+L). Zero data egress: only schemas reach the LLM, never your rows.

---

## What it is

- **No database server.** DuckDB runs in-process, reads files directly.
- **No data leaves your machine.** Only column names and types are sent to the LLM.
- **LLM-agnostic.** Swap between OpenAI, Anthropic via OpenRouter, or local models (LM Studio) with one config change.
- **Fast.** Handles 500MB+ Parquet files. Results capped at 10,000 rows by default.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.11+ | [python.org](https://python.org) |
| uv | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| just | latest | `curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh \| bash -s -- --to ~/.local/bin` |

---

## Quickstart

```bash
git clone <repo-url> medha
cd medha

# Install all deps
just install

# Start backend + frontend
just dev
```

Open http://localhost:5173, set your workspace directory, and start querying.

---

## LLM Configuration

Set environment variables before running `just dev`:

```bash
# OpenAI (default for Cmd+K inline edit)
export OPENAI_API_KEY=sk-...

# Anthropic via OpenRouter (default for Cmd+L chat agent)
export OPENROUTER_API_KEY=sk-or-...

# Local model via LM Studio (optional)
export LM_STUDIO_URL=http://localhost:1234/v1
```

Model selection is available in the UI header. All routing goes through litellm.

---

## Key Bindings

| Binding | Action |
|---------|--------|
| `Cmd+Enter` | Execute SQL in editor |
| `Cmd+K` | Inline AI edit (select SQL first, or place cursor) |
| `Cmd+L` | Open/focus chat sidebar |

---

## Architecture

```
Frontend (Vite + React + TypeScript)
  CodeMirror 6   TanStack Table   Chat SSE
        |               |              |
        +---------------+--------------+
                        |
              FastAPI (Python)
                        |
              +----------+----------+
              |          |          |
           DuckDB    litellm    LangGraph
        (in-process)  (routing)  (ReAct agent)
```

Data flow for Cmd+K:
```
user types instruction
  -> POST /api/ai/inline (schema only, no rows)
  -> litellm -> LLM
  -> SQL string returned
  -> diff rendered in editor (accept/reject)
```

Data flow for Cmd+L:
```
user asks question
  -> POST /api/ai/chat (SSE stream)
  -> LangGraph ReAct agent
       -> get_schema tool (local DuckDB call)
       -> sample_data tool (local DuckDB call, 5 rows max)
       -> execute_query tool (local DuckDB call, 20 rows max)
  -> tokens stream back to UI
  -> "Copy to Editor" button on any SQL blocks
```

---

## Development

```bash
just --list        # show all recipes

just backend       # backend only (port 18900)
just frontend      # frontend only (port 5173)
just dev           # both together

just test          # run pytest (21 tests)
just test-cov      # with coverage report
just typecheck     # TypeScript type check
just lint          # ruff lint
just fmt           # ruff format
just ci            # full verify: install + test + build + typecheck
```

---

## Project Structure

```
medha/
  backend/              Python FastAPI + DuckDB + LangGraph
    app/
      main.py           FastAPI entry, lifespan, CORS
      db.py             DuckDB manager (async, path-safe, auto-LIMIT)
      workspace.py      File scanner, schema cache
      ai/
        inline.py       Cmd+K single-turn litellm call
        tools.py        LangGraph tools (get_schema, sample_data, execute_query)
        agent.py        ReAct agent with SSE streaming
      routers/          FastAPI route handlers
    tests/              pytest suite (21 tests, all passing)

  frontend/             Vite + React + TypeScript
    src/
      components/       FileExplorer, SqlEditor, ResultGrid, ChatSidebar, DiffOverlay
      lib/api.ts        Typed fetch wrappers for all endpoints
      store.ts          Zustand global state

  justfile              Task runner (just dev, just test, just ci)
  SPEC.md               Full architecture specification
```

---

## Constraints

- Workspace directory is sandboxed: queries cannot access paths outside it
- No `../` traversal allowed in SQL
- Result rows capped at 10,000 (configurable in `backend/app/db.py:MAX_ROWS`)
- Only schemas (column names + types) sent to LLM. No row data unless user explicitly approves a sample via the chat sidebar
