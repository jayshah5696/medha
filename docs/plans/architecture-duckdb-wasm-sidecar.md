# Architecture: DuckDB-WASM + On-Demand Sidecar

**Date:** 2026-04-16  
**Status:** Research & design — implement on separate branches  
**Goal:** Further reduce memory + app size by splitting query execution from AI

---

## Current Architecture

```
┌─────────────────────────────────────────────────────┐
│ Electron Main Process (85 MB RSS)                   │
│   - Window management, IPC, proxy server            │
│   - Spawns backend at boot (ALWAYS)                 │
├─────────────────────────────────────────────────────┤
│ Electron Renderer (100-150 MB RSS)                  │
│   - React UI, CodeMirror, TanStack Table            │
│   - All queries go through HTTP to backend           │
├─────────────────────────────────────────────────────┤
│ Python Sidecar (78-200 MB RSS)                      │
│   - FastAPI + DuckDB (37 MB .so)                    │
│   - litellm + langchain + langgraph (loads on AI use)│
│   - ALWAYS running, even if user never uses AI       │
│   - 124 MB on disk                                   │
└─────────────────────────────────────────────────────┘
Total idle: ~253 MB RSS, 371 MB disk
```

**Problem:** The Python sidecar is always running. Most users open Medha to write SQL — they may never use AI. But they're paying for the Python runtime (17 MB), DuckDB native lib (37 MB on disk), and the process overhead.

---

## Option A: On-Demand Sidecar (Simpler, Faster to Ship)

### Concept
Don't spawn the Python backend at boot. Start it on first `/api/ai/*` request. Move query execution to Node.js using the `duckdb` npm package (Node.js bindings for DuckDB).

```
┌─────────────────────────────────────────────────────┐
│ Electron Main Process                                │
│   - DuckDB via Node.js bindings (query execution)    │
│   - Spawns Python sidecar ONLY on first AI request   │
├─────────────────────────────────────────────────────┤
│ Electron Renderer                                    │
│   - React UI (unchanged)                             │
│   - Queries go through IPC to main process           │
├─────────────────────────────────────────────────────┤
│ Python Sidecar (ONLY when AI is used)                │
│   - FastAPI with AI endpoints only                   │
│   - Lazy-loads litellm/langchain on first request    │
│   - NOT started until user opens Cmd+K or Cmd+L      │
└─────────────────────────────────────────────────────┘
```

### Implementation Plan

**Branch: `feature/on-demand-sidecar`**

#### Step 1: Node.js DuckDB Query Engine
```bash
npm install duckdb  # Node.js bindings, ~15 MB
```

Create `electron/query-engine.ts`:
```typescript
import * as duckdb from 'duckdb';

const db = new duckdb.Database(':memory:');
const conn = db.connect();

export function executeQuery(sql: string): Promise<QueryResult> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve({ columns: Object.keys(rows[0] || {}), rows, ... });
    });
  });
}
```

Register as IPC handler in main process:
```typescript
ipcMain.handle('query', async (_, sql) => {
  return executeQuery(sql);
});
```

#### Step 2: Frontend Query Path
Update `api.ts` to use IPC for queries instead of HTTP:
```typescript
export async function runQuery(query: string): Promise<QueryResult> {
  return window.electronAPI.query(query);
}
```

#### Step 3: Deferred Sidecar
In `electron/sidecar.ts`, only spawn when needed:
```typescript
let backendProcess: ChildProcess | null = null;

export async function ensureBackend(): Promise<number> {
  if (backendProcess) return backendPort;
  backendProcess = spawnBackend(backendPort);
  await waitForHealth(backendPort, 15000);
  return backendPort;
}
```

In `electron/main.ts`, proxy AI requests with lazy start:
```typescript
if (pathname.startsWith('/api/ai/')) {
  const port = await ensureBackend(); // starts sidecar on first AI request
  // proxy to Python backend
}
```

#### Step 4: Strip Query Endpoints from Python Backend
Remove `routers/db.py`, `routers/workspace.py` (file scanning), `routers/history.py` from the Python backend. It becomes AI-only. The Node.js main process handles workspace, queries, export, and history.

### Effort Estimate
| Task | Time |
|------|------|
| Node.js DuckDB query engine | 1 day |
| IPC handlers + preload bridge | 4 hours |
| Frontend IPC query path | 4 hours |
| Deferred sidecar spawn | 2 hours |
| Strip Python query endpoints | 2 hours |
| Move workspace/history to Node.js | 1 day |
| Testing & integration | 1 day |
| **Total** | **~4 days** |

### Impact
- **No Python process until AI is used** — most sessions never start it
- **Idle memory:** 253 MB → ~150 MB (Electron + Node DuckDB only)
- **Disk:** Similar (DuckDB Node.js is ~15 MB vs 37 MB native .so, but adds Node overhead)
- **Startup:** No Python boot delay at all for non-AI sessions

### Risks
- DuckDB Node.js bindings may behave differently than Python bindings (edge cases in type serialization)
- Maintaining two DuckDB integrations (Node for queries, Python for AI tools)
- Workspace/file watching currently in Python — needs reimplementation in Node.js

---

## Option B: DuckDB-WASM in Renderer (More Ambitious)

### Concept
Run DuckDB-WASM directly in the Electron renderer process. No separate query process at all. Python sidecar is AI-only and on-demand.

```
┌─────────────────────────────────────────────────────┐
│ Electron Main Process (minimal)                      │
│   - Window management, IPC for file system access    │
│   - Spawns Python ONLY on first AI request           │
├─────────────────────────────────────────────────────┤
│ Electron Renderer                                    │
│   - React UI                                         │
│   - DuckDB-WASM (query execution, in-browser)        │
│   - File access via Electron IPC bridge              │
├─────────────────────────────────────────────────────┤
│ Python Sidecar (AI-only, on-demand)                  │
│   - Only AI endpoints                                │
│   - ~30 MB on disk (no DuckDB, no workspace logic)   │
└─────────────────────────────────────────────────────┘
```

### Implementation Plan

**Branch: `feature/duckdb-wasm`**

#### Step 1: Add duckdb-wasm
```bash
cd frontend && npm install @duckdb/duckdb-wasm
```

Create `frontend/src/lib/duckdb.ts`:
```typescript
import * as duckdb from '@duckdb/duckdb-wasm';

let db: duckdb.AsyncDuckDB | null = null;

export async function initDuckDB(): Promise<void> {
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
}

export async function executeQuery(sql: string): Promise<QueryResult> {
  const conn = await db!.connect();
  const result = await conn.query(sql);
  // Convert Arrow result to our QueryResult shape
  ...
  await conn.close();
}
```

#### Step 2: File System Bridge
DuckDB-WASM can't access the local filesystem directly. Use Electron IPC:

```typescript
// In preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  listFiles: (dir: string) => ipcRenderer.invoke('list-files', dir),
});

// In main process
ipcMain.handle('read-file', async (_, path) => {
  return fs.readFileSync(path);
});
```

Then register files with DuckDB-WASM:
```typescript
const fileBuffer = await window.electronAPI.readFile(filepath);
await db.registerFileBuffer(filename, new Uint8Array(fileBuffer));
// Now: SELECT * FROM 'filename.csv' works
```

#### Step 3: OPFS for Large Files (Optional)
For files > 100 MB, use OPFS (Origin Private File System) to avoid loading into memory:
```typescript
await db.registerFileHandle('large.parquet', fileHandle, 
  duckdb.DuckDBDataProtocol.BROWSER_FILEREADER);
```

### Effort Estimate
| Task | Time |
|------|------|
| DuckDB-WASM setup + initialization | 4 hours |
| Query execution in WASM | 4 hours |
| File system IPC bridge | 1 day |
| Workspace/schema via WASM | 4 hours |
| File watching (Node.js watchFiles replacement) | 4 hours |
| Export (CSV/Parquet via WASM) | 4 hours |
| AI sidecar (strip to AI-only) | 4 hours |
| Testing & edge cases | 1 day |
| Performance testing (WASM vs native) | 4 hours |
| **Total** | **~6-8 days** |

### Impact
- **Disk:** DuckDB-WASM is ~15 MB (vs 37 MB native .so). Python sidecar drops to ~30 MB (AI only). Total sidecar: 30 MB vs 124 MB. App: ~290 MB.
- **Memory:** No Python process for query-only sessions. WASM runs inside the existing renderer process.
- **Startup:** Near-instant for queries. WASM initializes in ~200ms.

### Risks
- **Performance:** DuckDB-WASM is 2-5× slower than native for large scans. Fine for typical Medha workloads (< 1 GB files, interactive queries).
- **File access:** Every file read goes through IPC. Adds latency for initial load, but DuckDB caches internally.
- **Arrow output:** DuckDB-WASM returns Arrow format by default. We'd need to convert to our QueryResult shape. (Ironic — we just removed pyarrow, and now the WASM version uses Arrow natively in JS.)
- **Feature parity:** DuckDB-WASM may lack some extensions available in native DuckDB.
- **Bundle size:** duckdb-wasm is ~15 MB added to frontend dist. But we save 37 MB from the sidecar. Net: -22 MB.

---

## Recommendation

### Do Option A First (On-Demand Sidecar)
- **4 days of work**, most of which is moving query/workspace logic to Node.js
- Gives the biggest user-visible win: no Python process for SQL-only sessions
- Keeps native DuckDB performance
- Simpler architecture change, lower risk

### Evaluate Option B After
- More ambitious, bigger payoff, but more risk
- DuckDB-WASM performance may not satisfy power users with large files
- File system bridge adds complexity
- Consider as v0.6 or v0.7 milestone

### Branch Strategy
```
main
├── feature/on-demand-sidecar    ← Option A (do first)
│   └── PR after testing with real workflows
│
└── feature/duckdb-wasm          ← Option B (evaluate after A ships)
    └── Spike branch, may not merge
```

---

## Comparison Summary

| Metric | Current | Option A (On-Demand) | Option B (WASM) |
|--------|---------|---------------------|-----------------|
| App disk size | 371 MB | ~370 MB | ~290 MB |
| Idle memory (no AI) | 253 MB | ~150 MB | ~120 MB |
| Idle memory (with AI) | 253 MB | ~300 MB | ~250 MB |
| Query latency | Native | Native | 2-5× slower |
| Startup time | 8s (Python boot) | <1s | <1s |
| Effort | Done | 4 days | 6-8 days |
| Risk | Low | Low-Medium | Medium-High |
| Python process | Always | On-demand | On-demand |
