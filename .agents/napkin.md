# Medha Agent Napkin

## Architectural Learnings

### 2026-03-06: Agent SSE stream blocks UI interaction

**Problem:** When the agent is answering a question via SSE (`/api/ai/chat`), the user can't execute queries or interact with the editor meaningfully.

**Root causes found (3 layers):**

1. **Frontend: `setEditorContent` called during agent streaming** — When the agent's `execute_query` tool fires, the SSE handler in `ChatSidebar.tsx` was calling `setEditorContent(event.sql)` which overwrites whatever the user is typing in the SQL editor. User loses their work mid-keystroke.

2. **Backend: `asyncio.Lock` created at module import time** — `_db_lock = asyncio.Lock()` in `db.py` was created at import time, binding to whatever event loop existed then. In tests (and potentially in ASGI lifespan), this caused `RuntimeError: Lock is bound to a different event loop`. Fixed by creating the lock lazily via `_get_db_lock()`.

3. **Backend: Lock contention between agent tools and user queries** — Both agent tools (`execute_query`, `sample_data`) and the public `/api/db/query` endpoint acquire the same `_db_lock`. While the lock scope per query is narrow (just the DuckDB execute), during a multi-step agent run (up to 10 iterations), the lock is acquired/released repeatedly, potentially making user queries wait.

**Fixes applied:**
- Frontend: Agent query results go to `agentLastQuery` state instead of `editorContent`. User's editor is never hijacked.
- Backend: `_db_lock` is now lazily created via `_get_db_lock()` with `reset_db_lock()` for tests.
- Backend: Lock scope was already narrow (per-query), confirmed with concurrency tests.

**Lesson:** In an SSE streaming architecture, never let background processing (agent) overwrite user-facing state (editor content, cursor position). Store agent results separately and let the user pull them in.

### 2026-04-08: UI bugfixes need tests first, especially for stateful panels and resizers

**Problem:** A UI bugfix pass for the results grid/right sidebar was started by changing implementation first and only adding regression tests afterward. That violated the project TDD rule and increased the chance of shipping state-management regressions around row selection, resizable columns, and sidebar/tab state.

**Root causes found:**

1. **Implementation-first debugging** — direct fixes were made while investigating visual bugs, without first locking expected behavior in tests.
2. **Stateful UI interactions are easy to regress** — result grid scroll state, selected row state, detail tab state, and sidebar open state all interact in subtle ways that are difficult to validate by inspection alone.
3. **Build/lint/test parity was not checked immediately** — a test run passed earlier, but build-specific TypeScript issues in test files were only caught later when `npm run build` was re-run.

**Fixes applied:**
- Added regression tests for `ResultGrid`, `RightSidebar`, `RecordDetailSidebar`, `ThinkingBlock`, `FileExplorer`, `ChatSidebar`, and `store`.
- Refactored code to satisfy lint/build constraints after tests were added.
- Re-ran `vitest`, `lint`, and `build` until all passed.

**Lesson:** For UI bugfixes, write the failing component/store test first, then implement. Always validate with the full frontend gate (`vitest`, `lint`, and `build`) before pushing, because TS/build issues can slip past isolated test runs.
