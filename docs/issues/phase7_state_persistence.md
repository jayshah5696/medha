# Phase 7: State Persistence — Making Medha Stateful Across Restarts

**Date:** 2026-03-06  
**Status:** 📋 Documented — awaiting confirmation  
**Severity:** HIGH — app feels broken on every restart

---

## The Problem

Medha is effectively **ephemeral**. Every time you restart the application, you get a blank slate:

- No workspace configured (even though `last_workspace` is saved in settings.json, nothing reads it on boot)
- No files visible  
- No chat threads loaded in the sidebar
- No query history visible
- API keys from `settings.json` not loaded into environment (only `.env` is read on startup)
- Editor content reset to `SELECT 1;`
- Active file selection gone
- Sidebar widths reset to defaults
- Chat sidebar open/closed state reset

The data is **on disk** (`~/.medha/settings.json`, `~/.medha/chats/*.json`, `~/.medha/history/`) but nothing wires it back up on boot.

---

## State Audit: What Exists vs What Loads

| State | Persisted Where | Loaded on Boot? | Gap |
|-------|----------------|-----------------|-----|
| `last_workspace` | `~/.medha/settings.json` | ❌ No | Backend has it, but never calls `set_workspace()` on startup; frontend never reads it |
| API keys | `~/.medha/settings.json` | ❌ No | Only `.env` is loaded via `load_dotenv()`. Keys saved via UI are in JSON but never pushed to `os.environ` on restart |
| Chat threads | `~/.medha/chats/*.json` | ❌ No | Thread list only fetched when user opens the THREADS dropdown |
| Query history | `~/.medha/history/**/*.sql` | ❌ No | Only fetched on ⌘H or sidebar toggle |
| Theme (dark/light) | `localStorage` | ✅ Yes | Works correctly |
| Banner dismissed | `localStorage` | ✅ Yes | Works correctly |
| Workspace path | Zustand (in-memory) | ❌ Ephemeral | Lost on refresh |
| Active files | Zustand (in-memory) | ❌ Ephemeral | Lost on refresh |
| Editor content | Zustand (in-memory) | ❌ Ephemeral | Resets to `SELECT 1;` |
| Sidebar widths | React state (in-memory) | ❌ Ephemeral | Resets to 240/320 |
| Chat open/closed | Zustand (in-memory) | ❌ Ephemeral | Resets to open |
| DuckDB `FILE_SEARCH_PATH` | DuckDB session | ❌ Ephemeral | Only set during `set_workspace()` |
| DuckDB schema cache | Python dict | ❌ Ephemeral | Rebuilt on first query |

---

## Proposed Solution: Two-Layer State Restoration

### Layer 1: Backend Startup — Restore Server State

**What:** On FastAPI lifespan startup, read `~/.medha/settings.json` and restore critical server-side state.

**Changes to `main.py` lifespan:**

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Load settings and push API keys to environment
    from app.routers.workspace import load_settings
    settings = load_settings()
    _apply_api_keys(settings)
    
    # 2. Restore last workspace if available
    if settings.last_workspace:
        try:
            from app.workspace import set_workspace
            set_workspace(settings.last_workspace)
        except Exception:
            pass  # workspace dir may have been moved/deleted
    
    # 3. Start file watcher if workspace loaded
    from app.workspace import start_watcher, stop_watcher
    from app import db
    if db.workspace_root is not None:
        start_watcher()
    
    yield
    stop_watcher()
    from app.db import conn
    conn.close()


def _apply_api_keys(settings):
    """Push saved API keys to os.environ for litellm."""
    import os
    key_map = {
        "OPENAI_API_KEY": settings.openai_api_key,
        "OPENROUTER_API_KEY": settings.openrouter_api_key,
        "ANTHROPIC_API_KEY": settings.anthropic_api_key,
        "GEMINI_API_KEY": settings.gemini_api_key,
    }
    for env_var, value in key_map.items():
        if value:
            os.environ[env_var] = value
```

**Effect:** After restart, the backend immediately has:
- ✅ Workspace configured with `FILE_SEARCH_PATH` set
- ✅ File watcher running
- ✅ API keys available for litellm
- ✅ Schema cache ready to rebuild on first query

### Layer 2: Frontend Boot — Restore UI State

**What:** On React app mount, fetch persisted state from the backend and `localStorage`, then hydrate the Zustand store.

#### 2a. New API endpoint: `GET /api/boot`

Single endpoint returns everything the frontend needs to restore state:

```python
@router.get("/api/boot")
async def boot():
    """Return all state needed for frontend hydration."""
    settings = load_settings()
    files = scan_files() if db.workspace_root else []
    threads = _list_threads()  # from chats.py
    history = _list_history_entries(20)  # recent history
    return {
        "workspace_path": str(db.workspace_root) if db.workspace_root else "",
        "files": files,
        "threads": threads,
        "recent_history": history,
        "settings": {
            "model_chat": settings.model_chat,
            "agent_profile": settings.agent_profile,
            "last_workspace": settings.last_workspace,
        },
    }
```

**Why a single endpoint?** Avoids 4-5 parallel requests on boot. One round-trip gets everything.

#### 2b. Frontend boot hook in `App.tsx`

```typescript
useEffect(() => {
    fetch("/api/boot")
        .then(r => r.json())
        .then(data => {
            if (data.workspace_path) setWorkspacePath(data.workspace_path);
            if (data.files) setFiles(data.files);
            if (data.threads) setChatHistory(data.threads);
            // inputPath in FileExplorer pre-populated from workspace_path
        })
        .catch(() => {});
}, []);
```

#### 2c. Zustand persist middleware for UI-only state

Use Zustand's built-in `persist` middleware for state that doesn't need server round-trips:

```typescript
import { persist } from "zustand/middleware";

export const useStore = create<MedhaStore>()(
    persist(
        (set) => ({
            // ... all existing state
        }),
        {
            name: "medha-ui-state",
            partialize: (state) => ({
                // Only persist UI preferences, not transient data
                leftWidth: state.leftWidth,
                rightWidth: state.rightWidth,
                resultPaneHeight: state.resultPaneHeight,
                isChatOpen: state.isChatOpen,
                editorContent: state.editorContent,
                activeFiles: state.activeFiles,
            }),
        }
    )
);
```

**What gets persisted via localStorage:**
- Sidebar widths (left, right)
- Result pane height (for FEAT-1)
- Chat sidebar open/closed
- Editor content (draft SQL)
- Active file selection

**What does NOT go in localStorage (fetched from `/api/boot` instead):**
- Workspace path (server-authoritative)
- File list (server-scanned)
- Chat threads (server-stored)
- Query history (server-stored)
- API keys (never in browser)

---

## State Flow After Fix

```
App restart
│
├─ Backend lifespan startup
│   ├─ load_settings() → push API keys to os.environ
│   ├─ set_workspace(last_workspace) → DuckDB FILE_SEARCH_PATH set
│   └─ start_watcher()
│
├─ Frontend mounts
│   ├─ Zustand hydrates from localStorage (widths, editor, active files)
│   ├─ GET /api/boot → workspace_path, files, threads, history
│   └─ Store populated → UI renders with full state
│
└─ User sees: workspace loaded, files listed, threads visible, 
   editor has their last SQL, sidebar widths preserved
```

---

## Implementation Checklist

### Backend (3 changes)
- [ ] `main.py`: Add `_apply_api_keys()` in lifespan — restore API keys from settings.json
- [ ] `main.py`: Add `set_workspace(settings.last_workspace)` in lifespan — restore workspace
- [ ] `workspace.py` or new `boot.py`: Add `GET /api/boot` endpoint — single hydration payload

### Frontend (3 changes)
- [ ] `store.ts`: Add Zustand `persist` middleware with `partialize` for UI-only state
- [ ] `store.ts`: Move `leftWidth`, `rightWidth` from `App.tsx` local state into Zustand store
- [ ] `App.tsx`: Add boot `useEffect` — call `GET /api/boot`, hydrate store on mount

### Tests
- [ ] Backend: Test `GET /api/boot` returns expected shape with/without workspace configured
- [ ] Backend: Test lifespan restores workspace from settings
- [ ] Backend: Test lifespan applies API keys to os.environ
- [ ] Frontend: Test store hydration from localStorage (Zustand persist)

---

## Edge Cases

| Case | Handling |
|------|----------|
| `last_workspace` dir was deleted/moved | `set_workspace()` raises `FileNotFoundError` → caught, workspace stays unconfigured, status bar shows "no workspace" |
| Settings file doesn't exist (fresh install) | `load_settings()` returns defaults, no workspace, no keys — same as today |
| API key in settings.json AND `.env` | `.env` loaded first via `load_dotenv()`, then settings.json overwrites — settings.json wins (intentional: UI is the source of truth) |
| Browser localStorage cleared | Zustand persist returns defaults (widths, editor = "SELECT 1;") but `/api/boot` still provides workspace + threads |
| Multiple browser tabs | Zustand persist uses localStorage — last-write-wins on widths/editor. Acceptable for single-user app. |

---

## What This Does NOT Solve (Future)

- **Per-workspace chat namespacing:** All chats are global, not scoped to a workspace. Needs workspace path hashing.
- **Session restore for multi-tab editor:** FEAT-3 (multi-tab) tabs need their own persistence strategy.
- **Undo across restarts:** Editor undo history is ephemeral (CodeMirror state). Not worth persisting.
