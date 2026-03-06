# Medha Audit — Gemini 3.1 Pro
Generated: 2026-03-05

## Summary
Medha establishes a strong foundation for a local-first DuckDB interface, successfully implementing core querying, local persistence, and LangChain tool integration. However, the current state critically fails on its sandbox isolation guarantees when unconfigured, entirely misses the Tauri/PyInstaller desktop wrapper, and lacks robust error handling for active LLM generation streams. The application is functional for web based MVP usage but falls significantly short of production safety and offline packaging requirements.

## 1. Spec vs Implementation
| Section | Status | Notes |
|---------|--------|-------|
| 4C: GET /api/events SSE | MISSING | No `watchfiles` background task in `workspace.py`, and no SSE event stream endpoint exists in `main.py`. |
| 4D: DELETE /api/ai/chat/{id} | MISSING | Endpoint to actively cancel an in-flight LangGraph agent stream is entirely absent. |
| 4E: HITL interrupt | MISSING | `agent.py` does not implement LangGraph human-in-the-loop interrupts or the `/resume` endpoint. |
| 5E: Cmd+H localStorage | PARTIAL | Cmd+H opens history, but it fetches from a backend API (`~/.medha/history/`) instead of the spec'd `localStorage`. |
| 5F: @filename parsing | DONE | `ContextPill.tsx` correctly parses `@filename` mentions via regex and adds them to active files. |
| 6: src-tauri/ directory | MISSING | The Rust Tauri shell and sidecar code is not in the repository. |
| 7: medha.spec PyInstaller | MISSING | The `medha.spec` build script is absent. |
| Arrow IPC | MISSING | `format="arrow"` parameter is accepted by `/api/db/query` but ignored; JSON rows are always returned. |

## 2. Code Quality
1. **db.py:48 (MEDIUM)**: `workspace_root` is a global variable accessed and modified across threads without locking, which could cause race conditions during workspace switch. `asyncio.Lock` correctly protects DuckDB execution.
2. **routers/ai.py:65 (HIGH)**: SSE streaming inside `/api/ai/chat` does not catch `asyncio.CancelledError`. If a client disconnects mid-stream, the LangChain agent continues burning tokens in the background.
3. **ai/agent.py:40 (LOW)**: The mtime-based YAML cache is correctly implemented, and `ChatLiteLLM` correctly uses the Litellm standard strings (e.g. `openai/gpt-4o-mini`).
4. **ai/inline.py:53 (DONE)**: Litellm exceptions (`AuthenticationError`, `RateLimitError`, `APIConnectionError`) are explicitly caught and surfaced as HTTPExceptions.
5. **routers/chats.py:46 (DONE)**: If API key is missing during slug generation, the exception is caught and it gracefully falls back to a timestamped slug.
6. **history.py:27 (DONE)**: Filename sanitization uses `re.sub(r"[^a-zA-Z0-9_\s]", "", sql)`, preventing path injection.
7. **ai/tools.py:45 (DONE)**: `execute_query` correctly invokes both `_check_sql_safety` and `_check_path_safety` before executing the agent's SQL.
8. **routers/workspace.py:80 (DONE)**: `GET /api/settings` successfully returns masked keys, and POST skips updates if the masked placeholder is passed back.

## 3. Test Coverage Gaps
1. **AI Endpoints**: `routers/ai.py` (`/api/ai/chat` and `/api/ai/inline`) has zero test coverage.
2. **Frontend AI UI**: `ChatSidebar.tsx`, `DiffOverlay.tsx`, and `ContextPill.tsx` (@filename parsing) have zero component tests.
3. **SSE Streaming**: No backend tests verify SSE payload chunking, event types, or connection cleanup.
4. **Query Cancellation E2E**: While a unit test covers deleting a non-existent query, there is no E2E test verifying successful interruption of a long-running DuckDB operation.
5. **Chat Continuation**: Providing an existing `thread_id` to `/api/ai/chat` is untested.

## 4. README Accuracy
1. **Test Badge Discrepancy**: The prompt asks if the badge says 48 tests. The README badge explicitly reads "tests-59 passing" (which correctly sums 41 backend + 18 frontend).
2. **Roadmap Inaccuracy**: None of the listed roadmap items (Tauri, PyInstaller, File watcher, HITL, Arrow IPC) are built yet, which accurately reflects the codebase.
3. **Missing Key Binding**: README documents `Cmd+L` for chat sidebar, but this binding is entirely missing from the CodeMirror `keymap` in `SqlEditor.tsx`.
4. **Architecture Diagram**: Mentions the `File Watcher` and `GET /api/workspace/files` broadcasting events, which is completely missing in implementation.

## 5. Security
1. **HIGH**: **Workspace Sandbox Bypass**: In `db.py` `_check_path_safety`, if `workspace_root` is `None` (unconfigured), the check immediately returns. This allows queries to read/write any file on the host machine relative to the backend's current working directory.
2. **MEDIUM**: **Settings File Permissions**: `workspace.py` saves `settings.json` using `write_text()` without setting restricted file permissions (e.g., 600), leaving plain text API keys accessible to any process.
3. **LOW**: **DuckDB Blocklist**: `_check_sql_safety` correctly blocks COPY, INSTALL, ATTACH, and httpfs, securing the endpoint once the workspace is actually configured.
4. **LOW**: **History Filenames**: Filenames are thoroughly stripped of special characters, eliminating path traversal risks during SQL persistence.
5. **LOW**: **CORS Sandbox**: `CORSMiddleware` correctly utilizes a strict localhost regex.

## 6. UX GAPS
1. **No Workspace Configured**: DuckDB silently falls back to the backend's working directory. A user can unknowingly query the source code directory.
2. **Backend Down**: If the backend is unreachable during frontend load, API calls fail silently with generic network errors, and the settings modal gets stuck in a loading state.
3. **Zero Files**: The UI displays "no files loaded" without an onboarding action or instruction to add files to the selected directory.
4. **Large Workspaces**: A basic file filter is implemented in `FileExplorer.tsx`, appearing only when file count exceeds 10.
5. **Model Indicator**: No persistent UI indicator displays the currently active inline or chat model without opening the settings modal.
6. **Schema Cache**: `schema_cache.clear()` is properly called when switching workspaces in `workspace.py`.
7. **Onboarding Banner**: Implemented in `App.tsx`; the UI surfaces a banner prompting API key configuration if no keys are found.

## Top 5 Priority Fixes
1. **Patch Unconfigured Path Safety Bypass**: Fix `_check_path_safety` in `db.py` to hard-reject all queries (raise `ValueError`) if `workspace_root` is `None`.
2. **Handle SSE Disconnects**: Implement `asyncio.CancelledError` handling in the `/api/ai/chat` stream generator to kill LangChain runs when the client closes the chat.
3. **Add Tauri & PyInstaller Wrappers**: Fulfill the core spec by creating the `src-tauri` directory and PyInstaller sidecar logic to enable desktop packaging.
4. **Wire Cmd+L Shortcut**: Add the missing `Mod-l` key binding in `SqlEditor.tsx` to actually toggle the chat sidebar as documented.
5. **Implement File Watcher**: Add `watchfiles` to `main.py` lifespan and create the `GET /api/events` SSE endpoint to push schema invalidations to the frontend dynamically.
