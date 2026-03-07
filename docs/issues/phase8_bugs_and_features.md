# Phase 8: Bugs & Features

**Date:** 2026-03-06  
**Status:** 📋 Documented — awaiting confirmation  

---

## Bugs

### BUG-8-1: Agent hits recursion limit — "Recursion limit of 10 reached"

**Severity:** HIGH  
**Error:** `Recursion limit of 10 reached without hitting a stop condition`

**Issue:** The LangGraph agent loops between model → tools → model → tools... and never reaches a stop condition. After 10 iterations, LangGraph throws a hard error. This happens when the agent gets into a cycle — e.g., calling `get_schema`, then `sample_data`, then `execute_query`, getting an error, retrying, calling schema again, etc.

**Root Cause:** Two issues compound:

1. **`max_iterations: 10` in `default.yaml` maps to `recursion_limit: 10`** — but in LangGraph, `recursion_limit` counts *every node execution* (model + tool nodes), not just agent "turns". A single agent turn = model node + tools node = 2 recursion steps. So `recursion_limit: 10` only gives **5 actual agent turns**, and the first turn often uses 2 tool calls (schema + sample), consuming 4 steps immediately.

2. **No stop-condition guidance in the prompt.** The system prompt says "write SQL using execute_query to validate it" but doesn't tell the agent to STOP after delivering the answer. If the model hallucinates another tool call after answering, the cycle continues.

**Proposed Fix:**

```yaml
# default.yaml
max_iterations: 25  # LangGraph recursion_limit (not agent turns)
```

```python
# agent.py — pass higher limit
config={"recursion_limit": max(max_iterations, 25)}
```

Plus add to system prompt:
```
After executing a query and receiving results, present the answer to the user 
and STOP. Do not call tools after you have the answer.
```

Also: surface the error gracefully in chat instead of crashing — catch the recursion error in `stream_agent_response()` and yield a user-friendly message:

```python
except GraphRecursionError:
    yield {"type": "error", "message": "Agent reached maximum iterations. Try a simpler question or break it into steps."}
```

---

### BUG-8-2: `[object Object]` rendered for JSON/nested columns in ResultGrid

**Severity:** HIGH  
**Screenshot:** Shows `INDEX_SETTINGS`, `SEGMENTS`, `SCHEMA` columns all displaying `[object Object],[object Object]...`

**Issue:** When querying JSON files or files with nested/struct columns, DuckDB returns complex types (dicts, lists of dicts). The backend serializes these correctly as JSON over the wire. But the frontend's `ResultGrid.tsx` cell renderer does:

```typescript
return String(val);  // String({foo: "bar"}) → "[object Object]"
```

**Root Cause:** `String()` on a JavaScript object produces `[object Object]`. The cell renderer has no special handling for objects or arrays.

**Proposed Fix:** Replace the cell renderer with smart type-aware formatting:

```typescript
cell: (info) => {
  const val = info.getValue();
  if (val === null) return <span style={{ ... }}>null</span>;
  if (typeof val === "object") {
    // JSON-stringify objects/arrays with truncation
    const json = JSON.stringify(val);
    const display = json.length > 120 ? json.slice(0, 120) + "…" : json;
    return (
      <span style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-xs)" }} title={json}>
        {display}
      </span>
    );
  }
  if (typeof val === "boolean") return String(val);
  return String(val);
},
```

**Enhancement (nice-to-have):** Click on a JSON cell → expand in a modal/popover with pretty-printed JSON + syntax highlighting.

---

### BUG-8-3: Workspace switch doesn't clear stale active files / context pills

**Severity:** MEDIUM

**Issue:** When changing workspace (e.g., from `/data/forecast/` to `/data/ecommerce/`), the previously selected files (`train.csv` from the old workspace) remain in the `activeFiles` array and show as context pills in the chat input. The agent then receives stale file references that don't exist in the new workspace.

**Root Cause:** `handleConfigure` in `FileExplorer.tsx` calls `setWorkspacePath()` and `setFiles()` but never clears `activeFiles`. The Zustand store has no `clearActiveFiles` action.

**Proposed Fix:**

```typescript
// store.ts — add clear action
clearActiveFiles: () => set({ activeFiles: [] }),

// FileExplorer.tsx — handleConfigure
await configureWorkspace(inputPath.trim());
setWorkspacePath(inputPath.trim());
clearActiveFiles();          // ← clear stale selections
const fileList = await getFiles();
setFiles(fileList);
```

Also: consider clearing `currentThreadId` and `messages` in `ChatSidebar` on workspace switch, since the thread was about the old workspace's data. Or at least show a divider "— workspace changed —".

---

### BUG-8-4: App restart doesn't restore workspace (state persistence)

**Severity:** HIGH

**Issue:** On restart, the app shows a blank workspace even though `~/.medha/settings.json` has `last_workspace` persisted. Threads and history are on disk but not loaded. The full analysis and solution is documented in [Phase 7: State Persistence](phase7_state_persistence.md).

**Key gap:** This bug is about the interaction between workspace, threads, and history:
- Should threads be **global** or **scoped per workspace**?
- Should history be **global** or **scoped per workspace**?

See the discussion in the next section.

---

## Design Discussion: Workspace-Scoped State

### The Question

> Threads and history should be tied to workspace, right?

**Current behavior:** Both are global.
- `~/.medha/chats/*.json` — all threads in one flat directory
- `~/.medha/history/YYYY-MM-DD/*.sql` — all history by date, no workspace grouping

**The case for workspace-scoped:**
- When you switch from `/data/sales/` to `/data/logs/`, seeing chat threads about "weekly sales trends" is noise
- History entries with `SELECT * FROM 'train.csv'` don't make sense when the current workspace has `nginx_access.log`
- Matches how DataGrip/DBeaver scope query consoles to connections

**The case for global (keep as-is):**
- Some queries are reusable across workspaces (generic SQL patterns)
- Users might want to reference a previous workspace's analysis
- Simpler implementation

### Recommended: Hybrid — Workspace-Scoped with Global Fallback

```
~/.medha/
├── settings.json              # global settings
├── workspaces/
│   ├── {hash1}/               # sha256(workspace_path)[:12]
│   │   ├── meta.json          # { "path": "/data/sales/", "last_opened": "..." }
│   │   ├── chats/
│   │   │   ├── weekly-sales.json
│   │   │   └── top-stores.json
│   │   └── history/
│   │       └── 2026-03-06/
│   │           └── 14-43-13_select_from_train.sql
│   ├── {hash2}/
│   │   ├── meta.json
│   │   ├── chats/
│   │   └── history/
│   ...
├── chats/                     # legacy global (migrated or kept for cross-workspace)
└── history/                   # legacy global
```

**How it works:**
1. When a workspace is configured, compute `hash = sha256(abs_path)[:12]`
2. Chats and history for that session go under `~/.medha/workspaces/{hash}/`
3. Left sidebar's THREADS section only shows threads for the current workspace
4. ⌘H history only shows queries for the current workspace
5. A "Global" toggle or "All workspaces" option lets users see everything if needed

**Migration:** Existing `~/.medha/chats/` and `~/.medha/history/` stay as-is. New entries go to the workspace-scoped location. Old entries could optionally be attributed to `last_workspace` if set.

---

## Features

### FEAT-8-1: Collapsible sidebar sections with workspace-aware layout

**Current:** The left sidebar has two fixed sections: file list (always visible) + history (collapsible). Both are in `FileExplorer.tsx`.

**Requested:** More structured sidebar like database GUIs — collapsible sections:

```
▼ WORKSPACE                    ← collapsible
  /Users/jshah/Documents/...
  [CONFIGURE] [📁]

▼ FILES                        ← collapsible
  features.csv    533.0 KB
  stores.csv      533 B
  test.csv        2.5 MB
  train.csv       12.3 MB

▼ HISTORY                      ← collapsible, auto-refresh
  14:43 SELECT MIN(Date)...
  14:37 SELECT * FROM train...
  
▶ SAVED QUERIES                ← collapsible, future
```

**Implementation:**
- Extract sidebar into composable `<SidebarSection title="..." defaultOpen={true}>` component
- Each section has a toggle arrow, title, and content slot
- Open/closed state persisted via Zustand persist (part of Phase 7 state persistence)
- Later: drag-to-reorder sections

### FEAT-8-2: Workspace history — recently opened workspaces

When no workspace is configured (or in workspace config section), show a list of previously opened workspaces:

```
RECENT WORKSPACES
  /Users/jshah/Documents/GitHub/forecast-soln/data/raw     (last: 2h ago)
  /Users/jshah/data/ecommerce/                              (last: 3d ago)
```

**Source:** `~/.medha/workspaces/*/meta.json` — each has `path` and `last_opened` timestamp.

Click to re-open that workspace instantly (calls `configureWorkspace` with the stored path).

---

### BUG-8-5: Context pills overflow sidebar when filenames are long

**Severity:** MEDIUM  
**Screenshot:** Long filenames like `case_study_submission_JayShah/Investment...` extend past the chat sidebar boundary, breaking layout.

**Issue:** Each context pill in `ContextPill.tsx` has `whiteSpace: "nowrap"` and no `maxWidth` or `overflow` constraint. When a filename includes nested directory paths (e.g., `case_study_submission_JayShah/chunk_holdings.csv`), the pill is wider than the sidebar container and overflows visually.

**Root Cause:** The pill `<span>` has:
```tsx
whiteSpace: "nowrap",   // prevents wrapping
// no maxWidth, no overflow, no textOverflow
```

The parent `<div>` has `flexWrap: "wrap"` so pills do wrap to new lines, but each individual pill can still be wider than the container.

**Proposed Fix:** Constrain individual pills with truncation:

```tsx
<span style={{
  // existing styles...
  whiteSpace: "nowrap",
  maxWidth: "100%",          // never wider than container
  overflow: "hidden",
  textOverflow: "ellipsis",
}}>
```

Also: show only the basename by default, full path on hover via `title`:
```tsx
const basename = name.includes("/") ? name.split("/").pop() : name;
// render
<span title={`schema: ${name}`}>
  schema: {basename} 
  <button ...>x</button>
</span>
```

This keeps pills compact while preserving full path on hover.

---

### FEAT-8-3: Live file watcher — schema invalidation + UI refresh

**Severity:** MEDIUM

**Issue:** When an external process updates a file in the workspace (e.g., a script appends rows to `train.csv`, or a new `output.parquet` is dropped in), the UI doesn't reflect the change. The file list is stale, the schema cache is stale, and any cached query results show old data.

**Current infrastructure (already built but incomplete):**

| Layer | What Exists | What's Missing |
|-------|-------------|----------------|
| Backend: `watchfiles` | ✅ `watch_workspace()` watches workspace dir, pushes `file_changed` events to `file_change_queue` | Events only contain `path` + `change` type — no new file metadata (size) |
| Backend: schema cache | ✅ `schema_cache` entry deleted for the changed filename in `watch_workspace()` | Only invalidates exact filename match — doesn't handle new files or deleted files |
| Backend: SSE endpoint | ✅ `GET /api/events` streams events from the queue | No differentiation between add/modify/delete in the SSE payload |
| Frontend: SSE listener | ✅ `openEventStream()` listens and calls `getFiles()` on any `file_changed` | Refreshes file list ✅ but doesn't invalidate active query results or notify the user |

**What's needed to complete the pipeline:**

1. **Enrich the SSE event** — include `change` type (`added`, `modified`, `deleted`) so the frontend can react appropriately:
   ```python
   await file_change_queue.put({
       "type": "file_changed",
       "path": filename,
       "change": change_type.name.lower(),  # "added" | "modified" | "deleted"
   })
   ```

2. **Frontend: differentiated reactions:**
   - **`added`**: Refresh file list (already happens). Show subtle toast: "New file: output.parquet"
   - **`modified`**: Refresh file list. If the modified file is in `activeFiles`, show a banner: "train.csv was updated externally. Re-run query?" with a one-click re-run button.
   - **`deleted`**: Refresh file list. Remove from `activeFiles` if present. Show toast: "train.csv was removed."

3. **Schema re-invalidation on query:** Schema cache is already cleared in `watch_workspace()`. Next `get_schema` call will re-describe. No extra work needed.

4. **Optional toast/notification component:** A lightweight notification system (bottom-right toasts, auto-dismiss after 5s) for file change events. Keeps the user informed without being intrusive.

---

### FEAT-8-4: Export results to CSV / Parquet

**Severity:** HIGH — core data workflow feature

**Issue:** There's no way to export query results from the result grid. Users have to manually copy data or write `COPY` statements (which are blocked by SQL safety checks).

**Requested behavior:**
- **Export button** in the ResultGrid status bar (next to row count / duration)
- Dropdown or two buttons: **CSV** | **Parquet**
- Exports **all rows from the query**, not just the displayed page (which is capped at 10,000 by `MAX_ROWS`)
- Triggers a file download in the browser

**Design — two approaches:**

#### Approach A: Backend export endpoint (Recommended)

New endpoint `POST /api/db/export` that re-runs the query with DuckDB's `COPY` to a temp file, then streams the file to the frontend:

```python
@router.post("/api/db/export")
async def export_query(req: ExportRequest):
    """Export query results to CSV or Parquet via DuckDB COPY."""
    # req.query = the SQL, req.format = "csv" | "parquet"
    
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=f".{req.format}", delete=False) as tmp:
        tmp_path = tmp.name
    
    # Use DuckDB COPY ... TO ... to write the full result (no LIMIT)
    copy_sql = f"COPY ({req.query.rstrip(';')}) TO '{tmp_path}' (FORMAT '{req.format}')"
    conn.execute(copy_sql)
    
    return FileResponse(tmp_path, filename=f"export.{req.format}", 
                        media_type="text/csv" if req.format == "csv" else "application/octet-stream")
```

**Key:** The export bypasses `MAX_ROWS` / `_auto_limit()` so users get the full result set, even if the grid only showed 10,000 rows. Still runs through `_check_sql_safety()` and `_check_path_safety()`.

**Security note:** The `COPY` here is internal (writing to a temp file controlled by the server), not user-supplied — so it doesn't conflict with the `COPY` block in `_check_sql_safety`. The export endpoint uses its own code path that doesn't go through the safety filter.

#### Approach B: Frontend-only CSV export

Generate CSV client-side from `queryResult.rows` already in memory:

```typescript
function exportCSV(result: QueryResult) {
  const header = result.columns.join(",");
  const rows = result.rows.map(row => 
    row.map(v => typeof v === "string" ? `"${v}"` : String(v)).join(",")
  );
  const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  // trigger download...
}
```

**Limitation:** Only exports the rows already loaded in the frontend (max 10,000). No Parquet support (needs binary encoding).

**Recommendation:** Use Approach A for full-fidelity export. Fall back to Approach B for quick CSV when backend is unreachable.

**UI placement:**

```
┌──────────────────────────────────────────────────────┐
│ 45 rows · 16.09ms                    [CSV] [Parquet] │
└──────────────────────────────────────────────────────┘
```

Buttons in the ResultGrid status bar, right-aligned. Disabled when no result. Shows a brief "Exporting..." state during download.

### BUG-8-6: Long nested file paths unreadable in sidebar — need horizontal scroll + tree view

**Severity:** MEDIUM  
**Screenshot:** Files like `case_study_submission_JayShah/chunk_holds/semantic_chunking.l...` are truncated even with the sidebar dragged very wide. Multiple files share the same prefix so all entries look identical after truncation.

**Issue:** The file list renders each file as a flat `name` string (the relative path from workspace root). For deeply nested workspaces, every entry starts with the same long prefix (`case_study_submission_JayShah/...`), making them indistinguishable when truncated. The user has to hover over each file to read the tooltip to tell them apart.

**Current behavior:** File names have `overflow: hidden` + `textOverflow: ellipsis` + `whiteSpace: nowrap`. This clips correctly but doesn't help readability — all entries look like `case_study_submission_JayShah/chunk_holds/...`.

**Proposed Fix — Both approaches, combined:**

#### A. Horizontal scroll on leaf file names

Every leaf file name that overflows gets horizontal scroll on hover — so users can always read the full name without resizing the sidebar:

```tsx
<span
  style={{
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }}
  onMouseEnter={(e) => {
    e.currentTarget.style.overflow = "auto";
    e.currentTarget.style.textOverflow = "clip";
  }}
  onMouseLeave={(e) => {
    e.currentTarget.style.overflow = "hidden";
    e.currentTarget.style.textOverflow = "ellipsis";
  }}
>
```

Applied to both file names (in tree leaves) and directory names (in tree nodes).

#### B. Tree view for nested paths

Group files by directory structure and render as a collapsible tree:

```
▼ case_study_submission_JayShah/
  ▼ chunk_holds/
      semantic_chunking.lance.json     2.2 KB
      semantic_chunking.lance.json     1.5 KB
      token_based_splitting.json       2.2 KB
  ▼ colbert/indexes/
      rag_model_seman...               47.5 KB
  Investment Case For Disruptiv...     204.1 KB
Feeding-2025-12-25.csv                 164 B
Investment Case For Disruptive...      204.1 KB
```

**Implementation:**

```typescript
interface FileTreeNode {
  name: string;           // basename or directory name
  fullPath?: string;      // full relative path (leaf files only)
  size_bytes?: number;    // leaf files only
  children?: FileTreeNode[];
  isExpanded?: boolean;
}

function buildFileTree(files: FileInfo[]): FileTreeNode[] {
  // Group by first path segment, recursively
  const root: FileTreeNode[] = [];
  for (const file of files) {
    const parts = file.name.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        current.push({
          name: part,
          fullPath: file.name,
          size_bytes: file.size_bytes,
        });
      } else {
        let dirNode = current.find(n => n.name === part && n.children);
        if (!dirNode) {
          dirNode = { name: part, children: [], isExpanded: true };
          current.push(dirNode);
        }
        current = dirNode.children!;
      }
    }
  }
  return root;
}
```

Recursive `<FileTreeItem>` component with indentation per depth level:

```tsx
function FileTreeItem({ node, depth, onFileClick, activeFiles }: Props) {
  const [expanded, setExpanded] = useState(node.isExpanded ?? true);
  const indent = depth * 16;

  if (node.children) {
    // Directory node
    return (
      <>
        <div onClick={() => setExpanded(!expanded)} style={{ paddingLeft: indent }}>
          <span>{expanded ? "▼" : "▶"}</span> {node.name}/
        </div>
        {expanded && node.children.map(child => (
          <FileTreeItem key={child.fullPath || child.name} node={child} depth={depth + 1} ... />
        ))}
      </>
    );
  }
  // Leaf file — clickable, with hover scroll
  return (
    <div onClick={() => onFileClick(node.fullPath!)} style={{ paddingLeft: indent }}>
      <span /* hover scroll */>{node.name}</span>
      <span>{formatBytes(node.size_bytes!)}</span>
    </div>
  );
}
```

**Key behaviors:**
- Directories default to expanded
- Click directory = toggle collapse
- Click leaf file = preview data (FEAT-2) + toggle active for agent context
- Flat files (no `/` in name) render at root level with no indentation
- If workspace has zero nesting, tree view degrades gracefully to the current flat list
- Scroll on hover applies to both directory names and leaf file names

### FEAT-8-5: Saved SQL files — multi-tab editor with save/rename/reopen

**Severity:** HIGH — core workflow feature

**Issue:** There's no way to save SQL queries for reuse. The editor is a single ephemeral buffer — restart or navigate away and the SQL is gone. Users working on multi-step analyses need to save intermediate queries, name them, and switch between them.

**Requested behavior (combines with Phase 7 FEAT-3 multi-tab):**

#### The Model: SQL files stored in app space

```
~/.medha/workspaces/{hash}/queries/
├── exploration.sql
├── weekly-sales-by-store.sql
├── date-range-check.sql
└── untitled-1.sql
```

Each `.sql` file is a user-created query. Files are workspace-scoped (queries about `train.csv` belong to the workspace that has `train.csv`).

#### UI: Tab bar above SQL editor

```
┌─────────────────┬──────────────────────┬─────────────┬─────┐
│ exploration.sql* │ weekly-sales.sql    │ untitled-1  │  +  │
├─────────────────┴──────────────────────┴─────────────┴─────┤
│ SELECT                                                      │
│   store, SUM(weekly_sales) as total                         │
│ FROM 'train.csv'                                            │
│ GROUP BY store                                              │
│ ORDER BY total DESC;                                        │
└─────────────────────────────────────────────────────────────┘
```

- **`*` indicator** on tab name = unsaved changes
- **`+` button** = new tab (creates `untitled-N.sql`)
- **`×` on tab** = close (prompt to save if dirty)
- **Double-click tab name** = rename inline
- **⌘S** = save current tab to disk
- **⌘W** = close current tab

#### Tab State in Zustand

```typescript
interface SqlTab {
  id: string;              // uuid
  filename: string;        // "exploration.sql"
  content: string;         // current editor text
  savedContent: string;    // last saved text (for dirty detection)
  isDirty: boolean;        // content !== savedContent
  queryResult?: QueryResult; // last result for this tab
}

interface TabStore {
  tabs: SqlTab[];
  activeTabId: string;
  openTab: (filename?: string) => void;
  closeTab: (id: string) => void;
  renameTab: (id: string, newName: string) => void;
  saveTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabContent: (id: string, content: string) => void;
}
```

#### Backend: SQL file CRUD

```python
# New endpoints in a queries router
GET  /api/queries                    # list saved .sql files for current workspace
GET  /api/queries/{filename}         # read file content
POST /api/queries/{filename}         # save/overwrite file content
PUT  /api/queries/{filename}/rename  # rename file
DELETE /api/queries/{filename}       # delete file
```

Storage: `~/.medha/workspaces/{hash}/queries/{filename}.sql`

#### Key Behaviors

| Action | Behavior |
|--------|----------|
| App opens | Load saved tabs from last session (persisted in workspace meta) |
| New tab (+) | Creates `untitled-N.sql` in memory, not saved until ⌘S |
| ⌘S | Writes content to `~/.medha/workspaces/{hash}/queries/{filename}.sql` |
| ⌘Enter | Runs active tab's SQL, stores result on the tab |
| Switch tab | Swaps editor content + result grid to that tab's state |
| Close last tab | Creates a new `untitled-1.sql` (always have ≥1 tab) |
| Agent runs query | Does NOT create a tab — result goes to grid, SQL shown in chat. User can click "→ editor" to open it in a new tab. |
| Workspace switch | Saves open tabs to old workspace meta, loads tabs for new workspace |

#### Left Sidebar Integration

Add a **SAVED QUERIES** section (collapsible, from FEAT-8-1):

```
▼ SAVED QUERIES
    exploration.sql
    weekly-sales-by-store.sql
    date-range-check.sql
```

Click to open in a tab. Right-click for rename/delete context menu.

#### Relationship to Other Features

- **FEAT-3 (Phase 7 multi-tab):** This supersedes and fully defines it. FEAT-3 was the concept; FEAT-8-5 is the implementation spec.
- **FEAT-8-1 (collapsible sections):** SAVED QUERIES section in sidebar depends on this.
- **Workspace scoping (DESIGN):** Queries stored under `~/.medha/workspaces/{hash}/queries/` — depends on workspace scoping being implemented first.
- **State persistence (Phase 7):** Open tab list persisted in workspace meta for restore on restart.

---

## Summary Table

| ID | Type | Severity | Description |
|----|------|----------|-------------|
| BUG-8-1 | Bug | HIGH | Agent recursion limit — `recursion_limit: 10` gives only 5 agent turns |
| BUG-8-2 | Bug | HIGH | `[object Object]` for JSON/nested columns in result grid |
| BUG-8-3 | Bug | MEDIUM | Workspace switch doesn't clear stale active files / context pills |
| BUG-8-4 | Bug | HIGH | App restart doesn't restore workspace (cross-ref Phase 7) |
| BUG-8-5 | Bug | MEDIUM | Context pills overflow sidebar with long filenames |
| BUG-8-6 | Bug | MEDIUM | Long nested file paths unreadable — tree view + horizontal scroll |
| FEAT-8-1 | Feature | MEDIUM | Collapsible sidebar sections |
| FEAT-8-2 | Feature | LOW | Recent workspaces list |
| FEAT-8-3 | Feature | MEDIUM | Live file watcher — schema invalidation + UI notifications |
| FEAT-8-4 | Feature | HIGH | Export results to CSV / Parquet (full result, not just displayed page) |
| FEAT-8-5 | Feature | HIGH | Saved .sql files — multi-tab editor with save/rename/reopen |
| DESIGN | Discussion | — | Workspace-scoped threads + history (hybrid model) |

---

## Suggested Implementation Order

1. **BUG-8-1** (recursion limit) — bump limit + prompt fix + graceful error
2. **BUG-8-2** (`[object Object]`) — cell renderer fix, ~10 lines
3. **BUG-8-3** (stale active files) — add `clearActiveFiles` + call on workspace switch
4. **BUG-8-5** (pill overflow) — maxWidth + truncation + basename display, ~5 lines
5. **BUG-8-6** (file tree view) — build collapsible tree from flat file list
6. **FEAT-8-4** (export CSV/Parquet) — backend endpoint + UI buttons in status bar
7. **BUG-8-4** (state persistence) — implement Phase 7 plan
8. **FEAT-8-3** (file watcher completion) — enrich SSE events, add toast notifications
9. **FEAT-8-1** (collapsible sections) — refactor sidebar
10. **Workspace scoping** — migrate to `~/.medha/workspaces/{hash}/`
11. **FEAT-8-5** (saved SQL + multi-tab) — depends on workspace scoping for storage
12. **FEAT-8-2** (recent workspaces) — depends on workspace scoping
