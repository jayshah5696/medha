# Medha — Local-First SQL IDE for Flat Files
**Version:** 0.1 (MVP Spec)
**Stack:** Vite + React + TypeScript + FastAPI + DuckDB + LangGraph + Tauri

---

## 1. Product Goal

A single-binary desktop app for querying Parquet, CSV, and JSON files with native DuckDB performance and AI-first UX. Zero data egress. Zero database server. Ships as a Tauri app wrapping a Vite frontend + PyInstaller Python sidecar.

---

## 2. Hard Constraints

- **Zero data egress:** Only schemas and explicitly user-approved row samples leave the machine. No full table contents ever sent to LLM.
- **LLM agnostic:** litellm SDK exclusively. No direct OpenAI/Anthropic SDK imports in application code.
- **Local file integrity:** All DuckDB queries scoped to the configured workspace root. Directory traversal rejected at the FastAPI layer.
- **Query safety:** All DuckDB calls run in `asyncio.to_thread` — blocking calls never touch the FastAPI event loop.
- **Result cap:** 10,000 rows max returned per query. DuckDB enforces via `LIMIT` injection before execution. UI shows truncation warning.

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
  
  src-tauri/        # Tauri 2.x Rust shell
    src/
      main.rs        # Tauri app entry, sidecar lifecycle
      sidecar.rs     # Port negotiation, health check, graceful shutdown
    tauri.conf.json
    Cargo.toml
```

### 3B. Process Model

```
Tauri (Rust)
  |-- spawns --> Python sidecar (PyInstaller binary)
  |               |-- FastAPI on dynamic port (18900-18999)
  |               |-- DuckDB in-process
  |               |-- LangGraph agent (lazy init)
  |
  |-- loads  --> Vite static build (embedded in Tauri bundle)
                  |-- polls sidecar health before enabling UI
                  |-- all API calls to localhost:{port}
```

**Port negotiation:** Tauri picks a free port in range 18900-18999 at startup, writes it to a temp file, passes path as env var `MEDHA_PORT_FILE` to sidecar. Sidecar reads file, binds on that port. Frontend reads port via `window.__MEDHA_PORT__` injected by Tauri before webview load.

**Sidecar lifecycle (Rust):**
1. Spawn sidecar subprocess
2. Poll `GET /health` with 100ms interval, timeout 10s
3. Inject port into webview JS context
4. On Tauri window close: SIGTERM sidecar, wait 2s, SIGKILL if still alive

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

Persisted to `localStorage` (Tauri: to app data dir via Tauri FS API).
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

## 6. Tauri Shell (Rust)

### src-tauri/src/sidecar.rs

```rust
// Functions:
// find_free_port(range: 18900..18999) -> u16
// write_port_file(port: u16, path: &Path)
// spawn_sidecar(port_file: &Path) -> Child
// wait_for_health(port: u16, timeout_secs: u64) -> Result<()>
// inject_port_to_webview(window: &Window, port: u16)
// graceful_shutdown(child: &mut Child)
```

Tauri sidecar config in `tauri.conf.json`:
```json
{
  "bundle": {
    "externalBin": ["binaries/medha-backend"]
  }
}
```

Binary naming convention: `medha-backend-x86_64-apple-darwin`, etc. (Tauri requires platform suffix).

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

# 2. Copy binary to Tauri sidecar location
cp backend/dist/medha-backend src-tauri/binaries/medha-backend-$(rustup show active-toolchain | cut -d- -f2-)

# 3. Build Vite static
cd frontend && npm run build
# Output: frontend/dist/ (embedded by Tauri)

# 4. Build Tauri app
cd src-tauri && cargo tauri build
# Output: src-tauri/target/release/bundle/
```

### Makefile

```makefile
dev:
	cd backend && uv run uvicorn app.main:app --reload --port 18900 &
	cd frontend && npm run dev

build:
	cd backend && pyinstaller medha.spec
	cp backend/dist/medha-backend src-tauri/binaries/medha-backend-$$(rustup show active-toolchain | awk '{print $$1}' | cut -d- -f2-)
	cd frontend && npm run build
	cd src-tauri && cargo tauri build

clean:
	rm -rf backend/dist backend/build
	rm -rf frontend/dist
	rm -rf src-tauri/target
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
- [ ] Tauri scaffold + sidecar lifecycle (Rust written by Opus)
- [ ] PyInstaller spec
- [ ] Port negotiation
- [ ] Single binary test on macOS

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
3. Tauri shell (Rust sidecar lifecycle) — you write the Rust, I don't
4. AI integration last (requires working backend+frontend)

Use uv for Python deps. Use npm for frontend. Write all Rust.
Test each phase with curl/httpie before moving to next.
No hallucinated dependencies. Only what's in the spec.
