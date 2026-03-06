# Session Log: Phase 6 UI & Agent Audit Fixes

**Date:** 2026-03-06  
**Scope:** Fix all 4 critical bugs from Phase 6 UI/Agent audit + implement active-files pipeline, query-result sync, meta config, and hardened serialization  
**Test baseline (start):** ~75 backend, ~18 frontend  
**Test baseline (end):** 96 backend (passing), 25 frontend (passing, +2 pre-existing SettingsModal failures)

---

## Tasks Completed

### 1. BUG-UI-1 — Logo Invisible in Dark Mode

| | |
|---|---|
| **File** | `frontend/src/App.tsx` |
| **Problem** | PNG logos had opaque backgrounds — dark logo on dark theme was invisible, light logo on light theme was invisible |
| **Root cause** | Theme-to-file mapping was swapped, AND PNGs had no transparency |
| **Fix** | Replaced both PNG `<img>` tags with a single **inline SVG** that uses `var(--accent)` as its fill color — automatically adapts to any theme without needing separate assets |
| **Decision** | SVG over fixing PNGs → more maintainable, zero asset files, theme-adaptive by construction |

### 2. BUG-UI-2 — Typography Too Small for Desktop Readability

| | |
|---|---|
| **Files** | `frontend/src/index.css`, `App.tsx`, `SqlEditor.tsx`, `ResultGrid.tsx`, `FileExplorer.tsx`, `ChatSidebar.tsx` |
| **Problem** | Base font 10–13px across all UI surfaces forced user to zoom browser to 175% |
| **Fix** | Multiple rounds of font-size bumps across all CSS variables and component styles. Final targets designed for **150% zoom readability**: body 16px, editor 17px, table headers 13px, table cells 15px, status bars 12px, chat messages 15px, sidebar file names 14px |
| **Decision** | Targeted 150% zoom as baseline (user was at 175%) — applied bumps uniformly across every component |

### 3. BUG-ARCH-1 — Directory Picker Web API Incompatible with Backend

| | |
|---|---|
| **Files** | `frontend/src/components/FileExplorer.tsx`, `frontend/src/lib/api.ts`, `backend/app/routers/workspace.py` |
| **Problem** | Browser's `showDirectoryPicker()` only returns the leaf folder name (e.g., `"SyntheticData"`) — not the absolute path. Backend requires absolute path for `workspace_root` sandbox. Old code already removed. |
| **Fix** | Built a **backend-powered folder browser modal**: `POST /api/workspace/browse` returns directory listing from the server, frontend renders a navigable folder picker with breadcrumbs, "Open" confirms the absolute path |
| **New types** | `DirEntry { name, is_dir, size? }`, `BrowseResult { path, entries[], parent? }` |
| **Tests added** | 7 new FileExplorer tests (browse button render, modal open/close, navigation, width prop), 2 new API tests for `browseDirectory` |

### 4. BUG-AI-1 — Agent Hallucinates File Extensions

| | |
|---|---|
| **Files** | `backend/agents/default.yaml`, `backend/agents/fast.yaml`, `backend/agents/deep.yaml` |
| **Problem** | Agent would query `data/sites` instead of `data/sites.csv` — hallucinating filenames without extensions |
| **Fix** | Hardened all 3 agent YAML system prompts with strict rules: "You MUST use the exact full filename including extension as shown in the active files list" + examples of correct vs incorrect usage |

### 5. Active Files Context Pipeline

| | |
|---|---|
| **Files** | `frontend/src/components/ChatSidebar.tsx` → `backend/app/routers/ai.py` → `backend/app/ai/agent.py` |
| **Problem** | Agent had no awareness of which files the user had selected in the file explorer |
| **Fix** | Frontend sends `active_files[]` in chat request body → router passes them to `stream_agent_response()` → agent prepends `[Active files in workspace: file1.csv, file2.parquet]` to the user's message so the LLM sees exact filenames |

### 6. FILE_SEARCH_PATH for Relative Path Resolution

| | |
|---|---|
| **Files** | `backend/app/workspace.py` |
| **Problem** | DuckDB queries with bare filenames like `SELECT * FROM 'train.csv'` failed because DuckDB didn't know the workspace root |
| **Fix** | `set_workspace()` now calls `SET FILE_SEARCH_PATH = '{root}'` on the DuckDB connection so relative filenames resolve against workspace root |
| **Decision** | Used DuckDB native `FILE_SEARCH_PATH` instead of SQL rewriting — single line, zero fragility, database handles resolution |

### 7. Query Result Agent → Editor Sync Pipeline

| | |
|---|---|
| **Files** | `backend/app/ai/tools.py`, `backend/app/ai/agent.py`, `frontend/src/components/ChatSidebar.tsx`, `frontend/src/components/SqlEditor.tsx`, `frontend/src/store.ts` |
| **Problem** | When the agent executed a SQL query via `execute_query` tool, the result never appeared in the editor or result grid — only in chat text |
| **Fix** | Hybrid Pattern 2+3: (1) `execute_query` stashes structured result in module-level `_last_query_result`, (2) after agent yields tool message, streamer calls `_pop_last_query_result()` and emits a `query_result` SSE event with columns + rows, (3) `ChatSidebar` listens for `query_result` events and updates Zustand store → `SqlEditor` and `ResultGrid` auto-populate |
| **Decision** | Module-level stash over LangGraph state extension — simpler, no state schema changes, works with existing SSE streaming |

### 8. JSON Serialization Safety for DuckDB Types

| | |
|---|---|
| **File** | `backend/app/ai/tools.py` |
| **Problem** | DuckDB returns Python types (`datetime`, `Decimal`, `UUID`, `bytes`, `timedelta`) that `json.dumps()` can't serialize — agent tool responses crashed |
| **Fix** | Added `_serialize_value()` function that handles: `date` → ISO string, `datetime` → ISO string, `Decimal` → float, `UUID` → string, `bytes` → hex, `timedelta` → total seconds. Applied to all rows before JSON serialization. |
| **Tests added** | Comprehensive test suite for all type conversions |

### 9. Meta Config: Model Slug + Last Workspace Persistence

| | |
|---|---|
| **Files** | `backend/app/routers/workspace.py`, `backend/app/routers/chats.py` |
| **Problem** | (a) Slug generation used the expensive chat model (e.g., GPT-4o) for trivial 1-line summaries, (b) workspace path lost between app restarts |
| **Fix** | Added `model_slug` field to Settings (defaults to `gpt-4o-mini`) — `generate_slug_from_message()` now calls `_get_slug_model()` to use the cheap model. Added `last_workspace` field persisted in `~/.medha/settings.json` — `save_last_workspace()` called on workspace configure |
| **Decision** | Both fields live in the existing `~/.medha/settings.json` — no separate config files |

### 10. CodeMirror Keybinding Fix

| | |
|---|---|
| **File** | `frontend/src/components/SqlEditor.tsx` |
| **Problem** | `Cmd+Enter` to run query was intercepted by CodeMirror's default bindings before reaching the custom handler |
| **Fix** | Wrapped the Run keymap in `Prec.highest()` so it takes priority over all other keymaps |

---

## Files Changed (Summary)

### Backend
| File | Change |
|------|--------|
| `backend/app/ai/agent.py` | Active files injection, `_pop_last_query_result` import, `query_result` SSE event emission |
| `backend/app/ai/tools.py` | `_serialize_value()`, `_last_query_result` stash, `_pop_last_query_result()` |
| `backend/app/routers/ai.py` | Passes `active_files` to `stream_agent_response()` |
| `backend/app/routers/workspace.py` | `model_slug`, `last_workspace` in Settings, `save_last_workspace()`, `POST /api/workspace/browse` |
| `backend/app/routers/chats.py` | `_get_slug_model()`, refactored slug generation |
| `backend/app/workspace.py` | `SET FILE_SEARCH_PATH` in `set_workspace()` |
| `backend/agents/default.yaml` | Hardened file extension rules |
| `backend/agents/fast.yaml` | Hardened file extension rules |
| `backend/agents/deep.yaml` | Hardened file extension rules |

### Backend Tests (New)
| File | Tests |
|------|-------|
| `backend/tests/test_ai_tools.py` | 102 lines — serialize_value for all DuckDB types, query result stash/pop lifecycle |
| `backend/tests/test_ai_agent.py` | 74 lines — active files injection, query_result SSE emission |
| `backend/tests/test_db.py` | 45 lines — FILE_SEARCH_PATH set on workspace configure |

### Frontend
| File | Change |
|------|--------|
| `frontend/src/App.tsx` | SVG logo, resizable sidebars, typography, theme toggle, status bar |
| `frontend/src/index.css` | CSS variables: heights, font sizes, button styles |
| `frontend/src/components/FileExplorer.tsx` | Width prop, browse button, folder picker modal, typography |
| `frontend/src/components/ChatSidebar.tsx` | Width prop, `query_result` event handler, `active_files` passing |
| `frontend/src/components/SqlEditor.tsx` | `Prec.highest` keymap, clickable Run button, `editorContent` sync |
| `frontend/src/components/ResultGrid.tsx` | Typography bumps |
| `frontend/src/lib/api.ts` | `browseDirectory()`, `DirEntry`/`BrowseResult` types |
| `frontend/src/store.ts` | `editorContent`, `queryResult`, workspace persistence |

### Frontend Tests (New)
| File | Tests |
|------|-------|
| `frontend/src/components/FileExplorer.test.tsx` | 7 tests — browse button, modal, navigation, width prop |
| `frontend/src/lib/api.test.ts` | 2 tests — browseDirectory API |

---

## Key Architectural Decisions

| # | Decision | Alternatives Considered | Rationale |
|---|----------|------------------------|-----------|
| D1 | Inline SVG with `var(--accent)` for logo | Fix PNG transparency, separate SVGs per theme | Zero asset files, inherently theme-adaptive, single source of truth |
| D2 | DuckDB `SET FILE_SEARCH_PATH` for relative paths | SQL rewriting / regex path injection | Native DuckDB feature, 1 line, no regex fragility |
| D3 | Module-level `_last_query_result` stash | Extend LangGraph state, Redis, queue | Simplest approach — no schema changes, single-request lifecycle |
| D4 | Hybrid SSE pattern (tool stash + SSE event) | WebSocket, polling, LangGraph callback | Works within existing SSE streaming, no new transport |
| D5 | `model_slug` in Settings JSON | Env var, separate config, hardcoded | User-configurable via existing Settings UI, persisted |
| D6 | `last_workspace` in `~/.medha/settings.json` | localStorage, separate file, SQLite | Single config file, backend-authoritative |
| D7 | Backend-powered folder browser | Fix `showDirectoryPicker`, electron dialog | Works in all browsers, gives real absolute paths |
| D8 | Typography at 150% zoom baseline | Larger (175%), smaller (125%) | Balances readability and information density |

---

## Known Remaining Work (Not in Scope for This Session)

### Phase B — Agent UX Polish
- [ ] Tool call visualization: show tool name + args in chat, collapsible thinking trace
- [ ] Remove `disabled={isStreaming}` — UI should not lock while agent streams
- [ ] Agent should receive workspace file list even when no files explicitly selected

### Phase C — Infrastructure
- [ ] Agent execution logs saved to `~/.medha/logs/agent/{slug}.jsonl`
- [ ] Frontend auto-configure workspace from `last_workspace` on boot
- [ ] Chat history scoped per workspace (namespace by workspace path hash)
- [ ] SSE disconnect handling — kill LangGraph run on client disconnect
- [ ] `asyncio.CancelledError` handling in `/api/ai/chat`

### From Gemini Audit (docs/AUDIT.md)
- [ ] `GET /api/events` SSE file watcher endpoint
- [ ] `DELETE /api/ai/chat/{id}` — cancel in-flight agent
- [ ] Human-in-the-loop interrupt + `/resume` endpoint
- [ ] Arrow IPC format support
- [ ] Tauri / PyInstaller desktop packaging

---

## Test Results (Final)

```
Backend:  96 tests passing
Frontend: 25 tests passing (2 pre-existing SettingsModal failures — unrelated to this session)
```
