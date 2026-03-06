# Medha Audit Report

## 1. SPEC COMPLETENESS
- **HIGH:** **Section 4C (File Watcher):** Completely missing. `workspace.py` does not use `watchfiles` to invalidate the schema cache, and the `GET /api/events` SSE endpoint does not exist.
- **HIGH:** **Section 4D (Agent Cancel):** The `DELETE /api/ai/chat/{thread_id}` endpoint to cancel an in-flight LangGraph agent is missing. `chats.py` only implements thread deletion from disk, not active cancellation.
- **MEDIUM:** **Section 4E (HITL):** Human-in-the-loop logic for large query confirmation is missing. The agent executes queries immediately without any SSE `hitl` pause/resume endpoints.
- **MEDIUM:** **Section 5E (History Storage):** Spec says history is persisted to `localStorage` accessible via Cmd+H. Code actually persists to the backend file system (`~/.medha/history/`) and fetches via API.
- **LOW:** **Arrow IPC:** The query endpoint accepts a `format` parameter but ignores it, unconditionally returning a JSON dictionary for the rows instead of Arrow IPC.
- **HIGH:** **Section 6 & 7 (Tauri & PyInstaller):** The entire `src-tauri` directory and `medha.spec` files are completely missing from the repository.

## 2. CODE QUALITY
- **HIGH:** **db.py Thread Safety & Mutability:** `conn` is a single module-level DuckDB connection. Since queries are run concurrently via `asyncio.to_thread`, this is not thread-safe and will cause crashes. `workspace_root` is also a mutable global accessed across threads without locks.
- **HIGH:** **tools.py Security Bypass:** The `execute_query` LangChain tool directly calls `db.conn.execute(sql)`. It completely bypasses `_check_path_safety` and `_auto_limit`, allowing the LLM to execute arbitrary unrestricted SQL on the host.
- **MEDIUM:** **Litellm Prefix:** `agent.py` passes standard Litellm prefix strings (e.g., `openai/gpt-4o-mini`) into LangChain's `ChatLiteLLM`.
- **MEDIUM:** **SSE Cleanup:** `routers/ai.py` does not handle `asyncio.CancelledError` inside the generator, meaning agent runs keep executing in the background if the client disconnects mid-stream.
- **LOW:** **Litellm Exceptions:** `inline.py` does not gracefully handle `RateLimitError` or `AuthenticationError`. It just catches `Exception` and returns a 500 error.

## 3. TEST COVERAGE
- **HIGH:** **0% Coverage on AI Endpoints:** The SSE streaming endpoints (`/api/ai/chat`), inline edit (`/api/ai/inline`), and all Litellm error paths are completely untested. No `test_ai.py` exists.
- **HIGH:** **0% Coverage on Frontend AI/Editor UI:** `ContextPill.tsx` (@filename parsing), `SqlEditor.tsx` (CodeMirror decorations and keyboard shortcuts), `DiffOverlay.tsx` (diff rendering), and `ChatSidebar.tsx` (thread continuation) have no test coverage.
- **MEDIUM:** **Query Cancellation:** There is no end-to-end test for actual query cancellation (`DELETE /api/db/query/{id}`) while a long-running query is in-flight.
- **LOW:** **File Watcher:** No tests (and the feature itself is missing).

## 4. README ACCURACY
- **MEDIUM:** **Test Badge:** Badge claims 59 tests passing, but there are only 58 (40 backend + 18 frontend).
- **HIGH:** **Roadmap:** The roadmap correctly lists Tauri, PyInstaller, File Watcher, HITL, and Arrow IPC as unchecked (which matches the code's missing features).
- **MEDIUM:** **Cmd+L Binding:** README says Cmd+L opens the chat sidebar, but `SqlEditor.tsx` only maps `Mod-Enter`, `Mod-k`, and `Mod-h`. `Mod-l` is not mapped anywhere.
- **LOW:** **Architecture Diagram:** Broadly accurate, though the query flow simplifies the backend execution. Profiles list matches the provided YAMLs.

## 5. SECURITY
- **CRITICAL:** **Workspace Sandbox Bypass:** In `db.py` `_check_path_safety`, if `workspace_root` is `None` (not yet configured), the function immediately returns without checking paths, allowing any absolute or relative path to be queried.
- **CRITICAL:** **LLM Arbitrary File Access:** As mentioned in Code Quality, `tools.py` bypasses all path validation. The agent can read or write any file on the machine.
- **HIGH:** **API Key Storage:** `settings.json` stores API keys in plaintext in `~/.medha/settings.json` with default OS permissions, exposing them to any process running as the user.
- **HIGH:** **DuckDB Extensions / Shell Execution:** DuckDB allows loading extensions, writing out files (`COPY TO`), and potentially executing commands. There are no restrictions stopping the user or agent from installing arbitrary extensions.
- **LOW:** **History Filenames:** SQL content is properly sanitized (`re.sub`) before being used in filenames, avoiding path injection.
- **LOW:** **CORS:** Securely locked to `localhost` via regex.

## 6. UX GAPS
- **HIGH:** **Unconfigured State:** If no workspace is configured, DuckDB falls back to the current working directory of the backend server. Queries will execute against whatever files happen to be there instead of showing an error.
- **MEDIUM:** **Backend Unreachable:** If the frontend loads and the backend is down, `fetch` calls fail silently or show generic network errors. `SettingsModal` hangs on a loading state.
- **LOW:** **Model Visibility:** There is no UI indicator for which LLM model is currently active without opening the Settings modal.
- **LOW:** **Concurrency UX:** `isQuerying` is a single global boolean in `zustand`. If you execute a query, you must wait for it to finish. You cannot run multiple queries concurrently in different editor tabs (since there are no tabs).
- **LOW:** **Empty State:** With zero files in the workspace, the sidebar just awkwardly says "no files loaded" with no further onboarding instructions.
