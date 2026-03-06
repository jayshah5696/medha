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
