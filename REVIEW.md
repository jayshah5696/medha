# Medha Code Review — Gemini 3.1 Pro
Generated: 2026-03-05

## Summary
Medha is a solid MVP for a local-first SQL IDE. The FastAPI and Vite foundations are well-structured, and the core concept of zero-egress DuckDB execution is implemented effectively. However, the application currently lacks the promised Electron desktop shell, has a few high-severity security oversights regarding file writing and API key exposure, and misses crucial error handling around LLM network calls. 

## 1. Spec vs Implementation
| Section | Status | Notes |
|---------|--------|-------|
| 2. Hard Constraints | PARTIAL | 10k row limit and basic path safety implemented. However, absolute LLM isolation relies on user trust (no strict enforcement preventing agent from requesting rows). |
| 3. Architecture | PARTIAL | `electron/` shell is completely missing from the repository. |
| 4. Backend Spec | DONE | Endpoints, file watcher, and DB managers are implemented as spec'd. |
| 5. Frontend Spec | PARTIAL | DiffOverlay, ChatSidebar, and editor are present. |
| 6. Electron Shell (Node.js) | MISSING | No Electron configuration or main process code exists. |
| 7. Build & Packaging | MISSING | PyInstaller and electron-builder scripts are absent. |
| 8. MVP Scope | PARTIAL | Phases 1-3 complete. Phase 4 (Desktop/Electron) not started. |
| 9/11/12. Agent/Config | DONE | YAML profiles, history, and chat persistence are implemented. |

## 2. Code Quality Issues
1. `backend/app/db.py:46`: **DuckDB Thread Safety** — `async_execute` delegates to `_execute_sync` via `asyncio.to_thread`, but DuckDB connection `conn` is shared globally. Concurrent queries on a single PyConnection can cause race conditions or crashes in DuckDB under load.
2. `backend/app/ai/agent.py:27`: **Agent Re-initialization** — `build_agent` is called on every request in `stream_agent_response`. It parses the YAML from disk and rebuilds the LangChain agent every time. This should be cached.
3. `backend/app/ai/inline.py:34`: **Missing try/except** — `await acompletion` has no exception handling. Network failures, quota limits, or invalid API keys will result in an unhandled 500 error.
4. `frontend/src/components/ChatSidebar.tsx:75`: **SSE Buffering** — The manual `TextDecoder` and `split("\n")` parsing does not robustly handle SSE chunking. It assumes JSON payloads won't be split mid-stream or contain escaped newlines.
5. `frontend/src/components/ResultGrid.tsx:84`: **TypeScript Types** — `info.getValue()` returns `unknown`, which is then converted to `String(val)`. While safe, it lacks strict typing for complex nested structures (like arrays or structs returned by DuckDB).
6. `frontend/src/components/SqlEditor.tsx:16`: **Missing Loading States** — When `isQuerying` is true, the editor itself doesn't indicate execution (though the result grid does). The user can repeatedly hit Cmd+Enter causing race conditions.

## 3. Test Coverage Gaps
1. **Frontend AI Components**: There are no tests for `ChatSidebar.tsx`, `DiffOverlay.tsx`, or `SqlEditor.tsx`.
2. **SSE Streaming**: The `/api/ai/chat` endpoint's SSE streaming behavior is entirely untested in both frontend and backend test suites.
3. **LLM Tool Execution**: The `test_ai_tools.py` likely tests the tool functions directly, but the integration between LangGraph and the `/api/ai/chat` endpoint error paths (e.g., LLM returning invalid tool calls) is untested.
4. **Settings Validation**: `POST /api/settings` error paths (e.g., malformed JSON or unwriteable settings file) are untested.

## 4. README Accuracy
1. **Electron/Desktop Claims**: README mentions "single-binary desktop app" and lists Electron in the roadmap/architecture, but the repo is purely a web app at this stage.
2. **Build Commands**: `just ci` and `just build` imply a complete build pipeline, but without Electron, the desktop build instructions will fail.
3. **Tests**: The badge says "59 passing", which aligns with the vitest (18) and pytest (41) count, so this is accurate.

## 5. Security Issues
- **HIGH** - **API Key Exposure**: `GET /api/settings` returns the user's OpenAI and OpenRouter API keys in plain text. A malicious local process or XSS could easily steal these.
- **HIGH** - **File Write Sandbox Escape**: `_check_path_safety` in `db.py` looks for absolute paths in quotes. However, `COPY (SELECT * FROM 'data.csv') TO 'output.csv'` uses a relative path and will write `output.csv` to the backend's current working directory, potentially overwriting source files.
- **LOW** - **CORS Configuration**: `allow_origin_regex` allows any localhost port, which is standard for local dev, but could allow another local web app to interact with Medha's API.

## 6. UX Gaps
1. **No API Key UX**: If a user runs Medha without an API key, pressing Cmd+K or Cmd+L will silently fail or throw an ugly 500 error toast. There is no proactive prompt to configure keys.
2. **First-run Experience**: Opening the app for the first time shows "no workspace". There is no sample dataset or immediate onboarding flow to guide the user to configure a directory.
3. **Missing Headers**: If a CSV has no header row, DuckDB will assign default headers (column0, column1). The agent will struggle to understand the schema without context.
4. **Large Workspaces**: If the workspace has 200+ files, `scan_files` returns all of them. The frontend File Explorer will become cluttered, and adding too many active files will blow up the LLM context window.
5. **Malformed Files**: If DuckDB fails to read a malformed Parquet file during `get_schema`, the AI agent will receive a raw DuckDB exception string and may get confused or hallucinate a schema.

## Top 5 Priority Fixes
1. **Mask API Keys**: Modify `GET /api/settings` to return masked keys (e.g., `sk-...1234`) and only update keys on `POST` if a new value is provided.
2. **Fix DuckDB CWD Sandbox**: Set DuckDB's working directory or restrict `COPY` and write operations to prevent users/LLMs from overwriting backend source files.
3. **Robust Error Handling for LLMs**: Add `try/except` blocks around `litellm.acompletion` and agent calls to gracefully surface quota/network errors to the frontend.
4. **Implement Electron Shell**: Build the `electron/` directory to fulfill the "desktop app" spec requirement.
5. **Connection Pooling/Thread Safety**: Ensure DuckDB connection access is either strictly serialized or use a connection pool if concurrent queries are expected.
