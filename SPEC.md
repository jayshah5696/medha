# Medha — Local-First SQL IDE for Flat Files
**Version:** 0.1 (MVP Spec)
**Stack:** Vite + React + TypeScript + FastAPI + DuckDB + LangGraph + Electron

---

## 1. Product Goal

A local web app for querying Parquet, CSV, and JSON files with native DuckDB performance and AI-first UX. Zero data egress. Zero database server. Electron desktop packaging coming soon.

---

## 2. Hard Constraints

- **Zero data egress:** Only schemas and explicitly user-approved row samples leave the machine. No full table contents ever sent to LLM.
- **LLM agnostic:** litellm SDK exclusively. No direct OpenAI/Anthropic SDK imports in application code.
- **Local file integrity:** All DuckDB queries scoped to the configured workspace root. Directory traversal rejected at the FastAPI layer.
- **Query safety:** All DuckDB calls run in `asyncio.to_thread` — blocking calls never touch the FastAPI event loop.
- **Result cap:** 10,000 rows max returned per query. DuckDB enforces via `LIMIT` injection before execution. UI shows truncation warning.
- **SQL keyword blocklist:** The following DuckDB operations are blocked at the query layer to prevent file exfiltration and extension loading: `COPY`, `EXPORT`, `INSTALL`, `LOAD`, `ATTACH`, `httpfs`, `sqlite_scan`. Both the public query endpoint and the agent's `execute_query` tool enforce this check.

---

## 3. Architecture

### 3A. Repository Layout

```
medha/
  backend/          # Python FastAPI + DuckDB + LangGraph
    app/
      main.py       # FastAPI app entry
      db.py         # DuckDB connection manager
      workspace.py  # File scanner + schema cache
      ai/
        inline.py   # Cmd+K litellm call
        agent.py    # Cmd+L LangGraph ReAct agent
        tools.py    # get_schema, sample_data, execute_query tools
      routers/
        workspace.py
        db.py
        ai.py
    pyproject.toml  # uv-managed deps
    medha.spec     # PyInstaller spec
  
  frontend/         # Vite + React + TypeScript
    src/
      components/
        FileExplorer.tsx
        SqlEditor.tsx      # CodeMirror 6
        ResultGrid.tsx     # TanStack Table
        ChatSidebar.tsx    # Cmd+L sidebar
        DiffOverlay.tsx    # Cmd+K accept/reject UI
      hooks/
        useWorkspace.ts
        useQuery.ts
        useChat.ts
      lib/
        api.ts             # typed fetch wrappers for all endpoints
        sqlFormat.ts       # sqlfluff/sql-formatter wrapper
      App.tsx
    vite.config.ts
    tsconfig.json
  
  electron/          # Electron shell (Node.js)
    main.js           # Electron main process entry, child process lifecycle
    preload.js        # Preload script: exposes IPC bridge to renderer
    child.js          # Port negotiation, health check, graceful shutdown
    package.json      # electron, electron-builder deps
    electron-builder.yml
```

### 3B. Process Model

```
Electron (main process, Node.js)
  |-- spawns --> Python child process (PyInstaller binary)
  |               |-- FastAPI on dynamic port (18900-18999)
  |               |-- DuckDB in-process
  |               |-- LangGraph agent (lazy init)
  |
  |-- loads  --> Vite static build (served via BrowserWindow)
                  |-- polls child process health before enabling UI
                  |-- all API calls to localhost:{port}
```

**Port negotiation:** Electron main process picks a free port in range 18900-18999 at startup using Node.js `net.createServer`, writes it to a temp file, passes path as env var `MEDHA_PORT_FILE` to the child process. Child process reads file, binds on that port. Frontend reads port via `window.__MEDHA_PORT__` injected by the preload script through `contextBridge.exposeInMainWorld`.

**Child process lifecycle (Electron main process):**
1. Spawn Python backend as a child process via `child_process.spawn`
2. Poll `GET /health` with 100ms interval, timeout 10s
3. Send port to renderer via IPC (`ipcMain`/`ipcRenderer`)
4. On Electron window close: SIGTERM child process, wait 2s, SIGKILL if still alive

---

## 4. Backend Spec (Python)

### 4A. Dependencies

```toml
[project]
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]",
  "duckdb>=1.2",
  "litellm>=1.55",
  "langgraph>=0.2",
  "langchain-core>=0.3",
  "watchfiles>=1.0",
  "python-multipart",
  "pandas>=2.2",
  "pyarrow>=17",
]
```

### 4B. DuckDB Connection Manager (`db.py`)

```python
# One DuckDB connection per process (thread-safe with asyncio.to_thread)
# All queries wrapped: asyncio.to_thread(conn.execute, sql, params)
# Workspace root enforced: reject any query containing '../' or absolute paths
# outside workspace_root after normalization
# Result cap: auto-inject LIMIT 10000 if no LIMIT present
# Query ID tracking: dict[uuid, Future] for cancellation support
```

### 4C. File Watcher (`workspace.py`)

```python
# watchfiles.awatch() on workspace_root in background asyncio task
# On file change: invalidate schema cache for affected file
# Broadcast SSE event to frontend: {"type": "file_changed", "path": "..."}
# Supported extensions: .parquet, .csv, .json, .jsonl
```

### 4D. API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Sidecar health check (returns `{"ok": true}`) |
| GET | `/api/workspace/files` | List files in workspace root with metadata |
| POST | `/api/workspace/configure` | Set workspace root path |
| POST | `/api/db/query` | Execute SQL, return columns+rows (JSON or Arrow) |
| DELETE | `/api/db/query/{query_id}` | Cancel in-flight query |
| GET | `/api/db/schema/{filename}` | Get column names+types for a file |
| POST | `/api/ai/inline` | Cmd+K: single-turn SQL generation via litellm |
| POST | `/api/ai/chat` | Cmd+L: LangGraph agent, SSE stream |
| DELETE | `/api/ai/chat/{thread_id}` | Cancel/abort active agent run |
| GET | `/api/events` | SSE stream for file watcher events |

**Query endpoint payload:**
```typescript
// Request
{ query: string, query_id: string, format: "json" | "arrow" }
// Response (json)
{ columns: string[], rows: any[][], truncated: boolean, row_count: number, duration_ms: number }
```

**Inline AI payload:**
```typescript
// Request
{ instruction: string, selected_sql: string, active_files: string[], model?: string }
// Response
{ sql: string, explanation?: string }
```

**Chat payload:**
```typescript
// Request (POST to start)
{ messages: Message[], active_files: string[], thread_id: string, model?: string }
// Response: SSE stream
// Events: {"type": "token", "content": "..."} | {"type": "tool_call", "tool": "...", "input": {...}} | {"type": "done"} | {"type": "error", "message": "..."}
```

### 4E. LangGraph Agent (`agent.py`)

**State:**
```python
class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    active_files: list[str]
    workspace_root: str
    last_error: str | None
```

**Tools (tools.py):**
```python
@tool
def get_schema(filename: str) -> str:
    """Get column names and types for a file in the workspace."""

@tool  
def sample_data(filename: str, columns: list[str] | None = None, n: int = 5) -> str:
    """Get sample rows. columns=None returns all. Use for date format detection."""

@tool
def execute_query(sql: str) -> str:
    """Run a DuckDB SQL query. Returns first 20 rows as markdown table + row count."""
    # Runs EXPLAIN first, returns error message if invalid (no exception to agent)
    # Scoped to workspace root, result cap 20 rows (agent use only)
```

**Graph:**
```
START -> agent_node -> (tool_call? -> tools_node -> agent_node) | END
```

Human-in-the-loop: LangGraph interrupt on `execute_query` tool if query touches >1M rows (estimated via `COUNT(*)`). Frontend receives `{"type": "hitl", "message": "Query will scan 2.3M rows. Proceed?"}`. User confirms via `POST /api/ai/chat/{thread_id}/resume`.

**Streaming:** `agent.astream_events()` with `version="v2"`. Filter for `on_chat_model_stream` (tokens) and `on_tool_start`/`on_tool_end` (tool call visibility).

---

## 5. Frontend Spec (TypeScript)

### 5A. Dependencies

```json
{
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "@codemirror/lang-sql": "^6",
    "@codemirror/view": "^6",
    "@tanstack/react-table": "^8",
    "tailwindcss": "^4",
    "diff-match-patch": "^1",
    "sql-formatter": "^15",
    "apache-arrow": "^18",
    "zustand": "^5",
    "react-markdown": "^9",
    "remark-gfm": "^4"
  }
}
```

### 5B. Layout

```
+------------------+-----------------------------+------------------+
| File Explorer    |  SQL Editor (CodeMirror)    | Chat Sidebar     |
| (left sidebar)   |  [Cmd+K overlay here]       | (Cmd+L)          |
|                  |-----------------------------|                  |
| workspace/       |  Results (TanStack Table)   | [markdown stream]|
|   data.parquet   |  [truncation badge]         |                  |
|   users.csv      |  [row_count] [duration_ms]  | [Copy to Editor] |
+------------------+-----------------------------+------------------+
```

### 5C. Cmd+K Flow (DiffOverlay.tsx)

1. User selects text in CodeMirror (or places cursor), presses Cmd+K
2. Floating input appears at cursor position (shadcn Popover)
3. User types instruction, hits Enter
4. `POST /api/ai/inline` with `selected_sql` + `active_files` (from global store)
5. Response SQL formatted via `sql-formatter` before diffing
6. `diff-match-patch` generates line-level diff (format both old and new SQL first)
7. DiffOverlay renders: red lines (removed), green lines (added)
8. "Accept" replaces CodeMirror selection. "Reject" dismisses.
9. Loading state: spinner in the popover, CodeMirror dims (CSS opacity)

### 5D. Cmd+L Flow (ChatSidebar.tsx)

1. User hits Cmd+L — right sidebar slides open
2. Selected CodeMirror text auto-populates input as quoted block
3. `POST /api/ai/chat` with thread_id (uuid, generated client-side per session)
4. Frontend opens SSE connection, consumes event stream:
   - `token`: append to markdown buffer, re-render
   - `tool_call`: show collapsible "Checking schema..." / "Sampling data..." indicator
   - `hitl`: show confirmation dialog (proceed/cancel)
   - `done`: finalize, show "Copy to Editor" button on any SQL code blocks
   - `error`: show error banner
5. "Copy to Editor" button: clicks paste SQL into CodeMirror at cursor
6. Thread persists in zustand store for conversation continuity within session

### 5E. Query History (useQuery.ts)

Persisted to `localStorage` (Electron: to app data dir via Electron's `app.getPath('userData')`).
Schema: `{ id, sql, timestamp, active_files, row_count, duration_ms, error? }`
Max 500 entries, LRU eviction.
Accessible via Cmd+H (history popover in editor toolbar).

### 5F. Context Indicator

Small pill in chat input showing what context is attached:
`[schema: data.parquet] [schema: users.csv]` with X to remove.
Clicking a file name in File Explorer adds it to active context.
`@filename` mentions in chat input also add to context (parsed client-side).

### 5G. Error Surfacing

DuckDB errors returned from `/api/db/query` include line number when available.
CodeMirror error decoration: red squiggle on the offending line.
Toast for general errors. Inline decoration for SQL errors.

---

## 6. Electron Shell (Node.js)

### electron/main.js

```javascript
// Electron main process entry point
// - Creates BrowserWindow loading Vite build (or dev server in dev mode)
// - Spawns Python backend as child process
// - Manages port negotiation via IPC
// - Handles app lifecycle (ready, window-all-closed, before-quit)
```

### electron/child.js

```javascript
// Functions:
// findFreePort(range: [18900, 18999]) -> Promise<number>
// writePortFile(port: number, filePath: string) -> void
// spawnBackend(portFilePath: string) -> ChildProcess
// waitForHealth(port: number, timeoutMs: number) -> Promise<void>
// gracefulShutdown(child: ChildProcess) -> void
```

### electron/preload.js

```javascript
// Exposes IPC bridge to renderer via contextBridge.exposeInMainWorld
// window.__MEDHA_PORT__ set via ipcRenderer.invoke('get-port')
// window.__MEDHA_ELECTRON__ = true (for environment detection)
```

Electron builder config in `electron-builder.yml`:
```yaml
appId: com.medha.app
productName: Medha
directories:
  output: dist-electron
files:
  - electron/**/*
  - frontend/dist/**/*
extraResources:
  - from: backend/dist/medha-backend
    to: medha-backend
mac:
  target: [dmg, zip]
win:
  target: [nsis, portable]
linux:
  target: [AppImage, deb]
```

Binary naming convention: `medha-backend` (single PyInstaller binary bundled as an extra resource).

---

## 7. Build & Packaging

### Development

```bash
# Backend
cd backend && uv run uvicorn app.main:app --reload --port 18900

# Frontend
cd frontend && npm run dev  # Vite dev server, proxies /api to :18900

# Run together
make dev
```

### Desktop Build

```bash
# 1. Bundle Python backend
cd backend && pyinstaller medha.spec
# Output: backend/dist/medha-backend (single binary)

# 2. Build Vite static
cd frontend && npm run build
# Output: frontend/dist/ (loaded by Electron BrowserWindow)

# 3. Build Electron app with electron-builder
cd electron && npx electron-builder --config electron-builder.yml
# Output: electron/dist-electron/ (platform-specific installer)
```

### Makefile

```makefile
dev:
	cd backend && uv run uvicorn app.main:app --reload --port 18900 &
	cd frontend && npm run dev

build:
	cd backend && pyinstaller medha.spec
	cd frontend && npm run build
	cd electron && npx electron-builder --config electron-builder.yml

clean:
	rm -rf backend/dist backend/build
	rm -rf frontend/dist
	rm -rf electron/dist-electron
```

---

## 8. MVP Scope (Weekend Build)

Phase 1 (Day 1 morning): Backend core
- [ ] FastAPI app with /health, /api/workspace/files, /api/db/query
- [ ] DuckDB connection manager with asyncio.to_thread, result cap, path safety
- [ ] Schema endpoint: GET /api/db/schema/{filename}
- [ ] File watcher (watchfiles)

Phase 2 (Day 1 afternoon): Frontend shell
- [ ] Vite + React + TS scaffold
- [ ] File Explorer sidebar
- [ ] CodeMirror 6 SQL editor
- [ ] TanStack Table result grid
- [ ] Wire to backend: browse files, execute queries, see results

Phase 3 (Day 2 morning): AI
- [ ] litellm inline edit (Cmd+K) + DiffOverlay
- [ ] LangGraph agent + SSE streaming chat (Cmd+L)
- [ ] get_schema, sample_data, execute_query tools
- [ ] Context indicator pill UI

Phase 4 (Day 2 afternoon / stretch): Desktop
- [ ] Electron scaffold + child process lifecycle (main.js, preload.js, child.js)
- [ ] PyInstaller spec
- [ ] Port negotiation via IPC
- [ ] electron-builder packaging test on macOS

---

## 9. LLM Configuration

User sets via Settings modal (persisted to app data):
```json
{
  "model_inline": "gpt-4.1-mini",
  "model_chat": "anthropic/claude-sonnet-4.6",
  "api_keys": {
    "openai": "sk-...",
    "openrouter": "sk-or-..."
  },
  "lm_studio_url": "http://localhost:1234/v1"
}
```

litellm router initialized at FastAPI startup with provided keys.
Model selection dropdown in UI header.

---

## 10. What Opus Will Build

Opus gets this SPEC.md plus the following instruction:

Build Medha per this spec. Priority order:
1. Backend (FastAPI + DuckDB) — fully working first
2. Frontend (Vite + React + TS) — functional second
3. Electron shell (child process lifecycle) — main.js, preload.js, child.js
4. AI integration last (requires working backend+frontend)

Use uv for Python deps. Use npm for frontend. Write all Rust.
Test each phase with curl/httpie before moving to next.
No hallucinated dependencies. Only what's in the spec.

---

## 11. Agent Architecture and Configuration

### 11A. LangChain Agent

The chat agent (Cmd+L) uses LangChain's `create_tool_calling_agent` with `AgentExecutor` instead of a hand-rolled LangGraph graph. This provides:

- Built-in tool calling via the LLM's native function calling API
- Streaming via `astream_events(version="v2")` for token-level SSE output
- Configurable `max_iterations` to prevent runaway tool loops
- Automatic parsing error recovery via `handle_parsing_errors=True`

The agent is constructed at request time from a YAML profile, making it hot-reloadable without restarting the server.

### 11B. YAML Agent Profiles

Agent behavior is configured via YAML files in `backend/agents/`. Each file defines:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Profile identifier |
| `model` | string | litellm model string (e.g. `openai/gpt-4o-mini`) |
| `temperature` | float | LLM temperature (0 = deterministic) |
| `max_iterations` | int | Max tool-call loops before the agent stops |
| `system_prompt` | string | Full system prompt injected into the agent |

Three profiles ship by default:

- **default**: `openai/gpt-4o-mini`, 10 iterations, balanced prompt for general data analysis
- **fast**: `openai/gpt-4o-mini`, 5 iterations, minimal prompt for quick queries
- **deep**: `anthropic/claude-sonnet-4.6`, 15 iterations, thorough prompt for complex analysis

To add a custom profile, create a new YAML file in `backend/agents/` and select it in the settings UI.

### 11C. Settings Persistence

User settings are stored at `~/.medha/settings.json` and include:

- `model_inline`: model for Cmd+K inline edits
- `model_chat`: model for Cmd+L chat
- `agent_profile`: which YAML profile to load (default/fast/deep)
- `openai_api_key`: OpenAI API key
- `openrouter_api_key`: OpenRouter API key
- `lm_studio_url`: local LM Studio endpoint

API keys are applied to `os.environ` on save so litellm picks them up immediately without a restart.

### 11D. Dependency Management (uv)

The backend uses `uv` for Python dependency management:

- `uv add <package>`: add a dependency (updates pyproject.toml and uv.lock)
- `uv sync`: install all deps from the lockfile
- `uv.lock`: committed to the repo for reproducible installs
- Never hand-edit the `[dependencies]` section in pyproject.toml; always use `uv add`

---

## 12. Local Persistence

### 12A. SQL History

Every successful query execution automatically saves the SQL to disk for later recall.

**Storage location:** `~/.medha/history/YYYY-MM-DD/`

**Filename format:** `HH-MM-SS_{sanitized_first_words}.sql`

**File format:**
```sql
-- executed: 2026-03-05 16:13:00
-- duration: 42ms
-- rows: 1234
-- workspace: /Users/jay/data
-- truncated: false

SELECT * FROM 'revenue.parquet' WHERE region = 'US';
```

**API endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/history` | List entries (newest first, max 100) |
| GET | `/api/history/{date}/{filename}` | Get full SQL content |
| DELETE | `/api/history` | Clear all history |

Each list entry contains: `id`, `filename`, `timestamp`, `preview` (first 80 chars), `duration_ms`, `row_count`.

### 12B. Chat Thread Persistence

Chat conversations are persisted as JSON files for cross-session recall.

**Storage location:** `~/.medha/chats/{slug}.json`

**JSON schema:**
```json
{
  "slug": "revenue-by-region",
  "created_at": "2026-03-05T16:13:00Z",
  "model": "openai/gpt-4o-mini",
  "agent_profile": "default",
  "active_files": ["data.parquet"],
  "messages": [
    {"role": "user", "content": "Show revenue by region"},
    {"role": "assistant", "content": "Here is the SQL..."}
  ]
}
```

**API endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/chats` | List threads (newest first) |
| GET | `/api/chats/{slug}` | Full thread content |
| POST | `/api/chats/{slug}/save` | Save/update a thread |
| DELETE | `/api/chats/{slug}` | Delete a thread |

### 12C. Slug Generation

When a new chat starts (no `thread_id` in the request), the backend generates a slug:

1. Call litellm with the configured model: system prompt asks for a 2-3 word lowercase kebab-case slug
2. Sanitize the response (lowercase, alphanumeric + hyphens only)
3. If litellm fails (no API key, network error, etc.), fall back to `chat-{YYYYMMDDHHMMSS}`

### 12D. Thread ID Flow via SSE

1. Frontend sends `POST /api/ai/chat` with `thread_id: ""` (new chat) or `thread_id: "existing-slug"` (continuation)
2. Backend streams agent response via SSE tokens
3. If new chat: backend generates slug, emits final SSE event: `data: {"type": "thread_id", "slug": "revenue-by-region"}`
4. Frontend receives `thread_id` event, stores it in zustand `currentThreadId`, refreshes thread list
5. Subsequent messages in the same chat send the stored `thread_id` to continue the conversation

---

## 13. Dynamic Model Selection (NOT YET BUILT)

### 13A. Problem with Current Approach

The current Settings modal hardcodes a fixed list of model strings (e.g. "openai/gpt-4o-mini", "anthropic/claude-sonnet-4.6"). This breaks for:
- LM Studio: user can load ANY model locally (llama-3.1-8b, mistral-7b, custom fine-tunes). The available models depend on what the user has downloaded.
- OpenRouter: has 200+ models. A hardcoded list is always stale.
- Ollama (future): same problem as LM Studio.

### 13B. Desired Behavior

Settings UI should be **provider-aware** with **dynamic model fetching**:

1. User selects a provider from a top-level dropdown: `OpenAI | Anthropic | Google Gemini | OpenRouter | LM Studio | Ollama | Custom`
2. After provider is selected (and API key/URL is set), a "Fetch Models" button queries the provider's model list endpoint
3. The model dropdowns (Inline/Cmd+K and Chat/Cmd+L) are then populated from the fetched list
4. Selected model is stored as the full litellm string (e.g. `openrouter/meta-llama/llama-3.1-70b-instruct`)

### 13C. Backend Endpoints Needed

```
GET /api/models?provider=openai           -> ["openai/gpt-4o", "openai/gpt-4o-mini", ...]
GET /api/models?provider=openrouter       -> ["openrouter/anthropic/claude-...", ...]
GET /api/models?provider=lm_studio       -> queries http://localhost:1234/v1/models, returns available local models
GET /api/models?provider=ollama          -> queries http://localhost:11434/api/tags, returns pulled models
```

**Implementation per provider:**
- **OpenAI:** call `https://api.openai.com/v1/models` with the stored API key, filter to chat-capable models (gpt-4*, gpt-3.5*)
- **Anthropic:** static list (Anthropic has no public models endpoint) — return known claude-* strings
- **Google Gemini:** call `https://generativelanguage.googleapis.com/v1beta/models?key={gemini_api_key}`, filter to `generateContent`-capable models, return `name` field prefixed with `gemini/` (litellm format: `gemini/gemini-2.0-flash`, `gemini/gemini-1.5-pro`, etc.)
- **OpenRouter:** call `https://openrouter.ai/api/v1/models` (no auth required for model list), return `id` field prefixed with `openrouter/`
- **LM Studio:** call `{lm_studio_url}/models` (OpenAI-compatible endpoint), return `id` field prefixed with `lm_studio/`
- **Ollama:** call `{ollama_url}/api/tags`, return `name` field prefixed with `ollama/`

**Error handling:** if the provider endpoint is unreachable or auth fails, return `{"error": "...", "models": []}`. Frontend shows "Could not fetch models — enter manually" with a free-text input fallback.

### 13D. Frontend UI Design

Settings modal redesign (provider-first layout):

```
PROVIDER
[ OpenAI ▼ ]   [ Fetch Models ]   ● connected / ✗ error

API KEY (or URL for local)
[ sk-... ]

INLINE / CMD+K MODEL
[ gpt-4o-mini ▼ ]   (populated from fetched list)

CHAT / CMD+L MODEL  
[ gpt-4o ▼ ]        (populated from fetched list)

AGENT PROFILE
[ default ▼ ]

[ Save ]
```

- Provider dropdown is the primary control. Changing provider clears the model selections.
- "Fetch Models" button: triggers `GET /api/models?provider=X`, populates dropdowns, shows spinner while loading.
- Connection indicator dot: green if last fetch succeeded, red if failed.
- Fallback: if user dismisses without fetching, show a plain text input so they can type a model string manually.
- Model strings stored in settings.json and sent to litellm as-is.

### 13E. Settings Schema Update

```json
{
  "provider_inline": "openai",
  "model_inline": "openai/gpt-4o-mini",
  "provider_chat": "openrouter",
  "model_chat": "openrouter/anthropic/claude-sonnet-4.6",
  "agent_profile": "default",
  "openai_api_key": "sk-...",
  "openrouter_api_key": "sk-or-...",
  "anthropic_api_key": "",
  "gemini_api_key": "",
  "lm_studio_url": "http://localhost:1234/v1",
  "ollama_url": "http://localhost:11434"
}
```

### 13F. YAML Agent Profile Update

Agent profiles should NOT hardcode a model. The `model` field in YAML should be treated as a default that is overridden by the settings `model_chat` value. If the YAML model is explicitly set, it takes precedence only when the user selects that profile and has no settings override.

Priority: `settings.model_chat` > `YAML profile model` > fallback `openai/gpt-4o-mini`

---

## 14. Workspace Directory Picker (NOT YET BUILT)

### 14A. Problem

Currently the user must type the full filesystem path manually (e.g. `/Users/jay/data`). This is error-prone and bad UX.

### 14B. Web Version (File System Access API)

Add a folder icon / "Browse" button next to the workspace path input:

```
[ > /path/to/data          ] [📁]
[ configure ]
```

On click: call `window.showDirectoryPicker()` (File System Access API, supported in Chrome/Edge).
- This opens the native OS folder picker (Finder on Mac, Explorer on Windows)
- The API returns a `FileSystemDirectoryHandle`, NOT a raw path string
- Extract `dirHandle.name` (folder name only, not full path) and show it as a hint
- Display a note: "Web limitation: enter the full path manually. Use the desktop build for native path resolution."
- Pre-fill the text input with the folder name as a starting point so the user just completes the path

Fallback: if `window.showDirectoryPicker` is not available (Firefox, Safari), hide the Browse button entirely.

### 14C. Electron Version (Recommended)

In the Electron desktop build, replace the text input + Browse button with a single "Choose Folder" button that calls Electron's native dialog:

```javascript
// Electron main process (main.js)
const { ipcMain, dialog } = require('electron')

ipcMain.handle('pick-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})
```

Frontend calls via the preload bridge:
```typescript
// preload.js exposes: window.electronAPI.pickDirectory()
const path = await window.electronAPI.pickDirectory()
// immediately configure workspace with returned path
```

This gives true native folder picker with full path returned. Auto-calls `POST /api/workspace/configure` with the result.

### 14D. UX Flow (Electron)

1. User clicks "Choose Folder" (or the folder icon)
2. Native OS folder picker opens
3. User selects a directory
4. Path auto-fills and `POST /api/workspace/configure` fires immediately
5. File list refreshes
6. No manual typing needed

### 14E. Detection Logic

At runtime, detect which environment we are in:

```typescript
const isElectron = '__MEDHA_ELECTRON__' in window
if (isElectron) {
  // use window.electronAPI.pickDirectory()
} else if ('showDirectoryPicker' in window) {
  // use File System Access API (hint mode)
} else {
  // text input only, no browse button
}
```

---

## 15. UI Polish Requirements (NOT YET BUILT)

### 15A. Buttons
- All buttons: transparent background, 1px solid #00D8FF border, #00D8FF text color
- Font: JetBrains Mono, 11px, uppercase, letter-spacing: 0.1em
- Padding: 4px 12px, border-radius: 0
- Hover: background rgba(0,216,255,0.08)
- No default browser button styling anywhere

### 15B. Chat Message Bubbles
- User messages: right-aligned, label "YOU" (8px uppercase accent above), border-left: 2px solid #00D8FF, padding: 6px 10px, background: rgba(0,216,255,0.04)
- Assistant messages: left-aligned, label "MEDHA" (8px uppercase dimmed above), border-left: 2px solid #1a1a1f, padding: 6px 10px, background: rgba(255,255,255,0.02)
- Tool call lines: italic, #444, format: `[ get_schema · running ]`
- 12px gap between messages
- Input: border 1px solid #1a1a1f, background #0f0f12, monospace, no border-radius, focus: border #00D8FF

### 15C. Toolbar
- Each chip: 10px monospace, color #444
- Hover: #00D8FF
- Running state: #00D8FF with CSS pulse animation (opacity 0.5-1, 1s loop)
- Vertical separator between groups

### 15D. Empty States
- No files: "NO FILES\nSet a workspace directory above\nto load Parquet, CSV, or JSON files."
- No threads: "No saved threads yet."
- Zero rows: "Query returned 0 rows."
- All: centered, #333, 11px monospace

### 15E. CSS Global
- Scrollbars: 4px width, #0f0f12 track, #222 thumb, #333 hover
- Selection: background rgba(0,216,255,0.15)
- Focus outlines: 1px solid #00D8FF
- Placeholder color: #333

### 15F. Silent Error Fix
- When LLM call fails (no API key, rate limit, network), show error inline in chat: red monospace text, not silent
- On page load: check GET /api/settings, if no keys configured show dismissable banner: "No LLM configured. Open Settings (⚙) to add an API key."

---

## 16. Workspace Folder Picker (NOT YET BUILT)

### 16A. Web Build
- Add folder icon button next to workspace text input
- On click: call window.showDirectoryPicker() (File System Access API, Chrome/Edge only)
- Returns folder name hint only (not full path due to browser security)
- Pre-fill input with folder name, user completes the path
- Hide button if showDirectoryPicker not available (Firefox, Safari)

### 16B. Electron Build
- Single "Choose Folder" button replaces text input + browse
- Calls Electron IPC `window.electronAPI.pickDirectory()` -> returns full OS path string via `dialog.showOpenDialog`
- Auto-calls POST /api/workspace/configure with result
- File list refreshes immediately

### 16C. Detection
```typescript
const isElectron = '__MEDHA_ELECTRON__' in window
if (isElectron) { /* window.electronAPI.pickDirectory() */ }
else if ('showDirectoryPicker' in window) { /* hint mode */ }
else { /* text only */ }
```

---

## 17. Logo (NOT YET BUILT)

### 17A. Concept
- Hexagon outline (thin 2px stroke, electric cyan #00D8FF, no fill)
- Devanagari letter म inside, centered, same cyan
- Wordmark "medha" below in JetBrains Mono lowercase, small
- Dark background #0a0a0b
- Flat design, no gradients, no shadows
- 1:1 square ratio for icon use

### 17B. Variants Needed
- Icon only (hexagon + म), for favicon and dock icon
- Icon + wordmark horizontal, for README hero
- Light variant (dark cyan on white) for light backgrounds

### 17C. Deliverables
- SVG source (scalable, usable in Electron app icon)
- PNG exports: 16px, 32px, 128px, 512px (for Electron bundle)
- Place in docs/brand/
