# CLAUDE.md — Medha

Local-first SQL IDE for querying Parquet/CSV/JSON files via DuckDB. Zero data egress.

## Tech Stack
- **Backend:** Python, FastAPI, DuckDB, LangGraph, litellm (uv-managed)
- **Frontend:** Vite, React, TypeScript, CodeMirror 6, TanStack Table
- **Desktop:** Electron (spawns Python child process on dynamic port 18900-18999)

## Commands (via `just`)
- `just install` — install all deps (backend + frontend)
- `just dev` — start backend (18900) + frontend (5173) together
- `just test` — backend pytest
- `just test-frontend` — frontend vitest
- `just test-all` — both
- `just lint` / `just fmt` — ruff check / ruff format (backend)
- `just typecheck` — `tsc --noEmit` (frontend)
- `just ci` — install + test + build + typecheck
- `just dev-desktop` — full stack with Electron

## Architecture
- `backend/app/` — FastAPI app, DuckDB connection, AI agent
- `frontend/src/` — React SPA (components, hooks, lib)
- `electron/` — Electron shell with child process management
- See `SPEC.md` for full architecture, endpoint specs, and constraints
- See `AGENTS.md` for TDD rules, patterns, and key learnings

## Key Conventions
- **TDD is mandatory** — write tests before features (see AGENTS.md)
- **Absolute imports** from `backend/app/`
- **LLM calls:** litellm SDK only, never direct provider SDKs
- **DuckDB calls:** always via `asyncio.to_thread`, never on event loop
- **Blocked SQL keywords:** COPY, EXPORT, INSTALL, LOAD, ATTACH, httpfs, sqlite_scan
- **Result cap:** 10,000 rows max per query

## Gotchas
- DuckDB connection is shared globally — concurrent queries can race (see REVIEW.md)
- `asyncio.Lock()` must be created lazily, not at module level (wrong event loop in tests)
- Agent SSE results go to separate state, never overwrite user's editor content
- Agent is rebuilt on every request — watch for perf if this becomes a bottleneck
- `_check_path_safety` doesn't catch relative paths in COPY statements
- No error handling around `litellm.acompletion` — network errors surface as 500s
