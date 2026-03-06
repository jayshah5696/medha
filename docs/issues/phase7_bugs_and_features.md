# Phase 7: Bugs & Feature Requests

**Date:** 2026-03-06  
**Source:** Live UI testing screenshots  
**Status:** ✅ Implemented — BUG-1, BUG-2, BUG-3, BUG-4, FEAT-1, FEAT-2 complete

---

## Bugs

### BUG-1: Agent has no workspace file awareness without manual selection

**Screenshot:** ![no files context](ss1 — agent says "I don't see any active files")  
**Severity:** HIGH

**Issue:** When a user asks "what data is available?" and hasn't explicitly clicked files in the sidebar, the agent responds "I don't see any active files in the workspace currently." — even though 4 files (features.csv, stores.csv, test.csv, train.csv) are clearly visible in the left sidebar.

**Root Cause:** `stream_agent_response()` only injects `[Active files in workspace: ...]` when the frontend passes `active_files[]` in the request body. If the user hasn't clicked any files, `active_files` is empty and the agent is completely blind to workspace contents.

**Proposed Fix:** When `active_files` is empty but a workspace is configured, auto-populate with all workspace files from `get_files()`. The agent always has context about what's available — user selection narrows focus, but absence of selection shouldn't mean zero awareness.

```python
# In stream_agent_response() or the router
if not active_files and workspace_root:
    from app.workspace import list_files
    all_files = list_files()
    active_files = [f["name"] for f in all_files]
```

---

### BUG-2: Chat thread slug not displayed — shows timestamp fallback

**Screenshot:** ![timestamp slug](ss2 — shows "chat-20260306143459")  
**Severity:** MEDIUM

**Issue:** Thread list shows `chat-20260306143459` instead of a descriptive LLM-generated slug like `data-head-query`. The slug generation via LLM appears to either be failing silently or the inline fallback is being used before the async LLM call completes.

**Root Cause:** In `ai.py`, the SSE stream generates the slug via `generate_slug_fallback()` (timestamp-based) for the inline thread_id SSE event. The actual LLM slug generation happens in `_save_thread_background()` but by then the frontend already received the timestamp slug. Even if the background task generates a better slug, it doesn't update the frontend.

**Proposed Fix:** Two options:
1. **Option A (Fast):** Call `generate_slug_from_message()` inline (before sending the thread_id SSE event) with a short timeout. If LLM fails within ~2s, fall back to timestamp.
2. **Option B (Better UX):** Emit the slug as a separate SSE event after the background task generates it. Frontend updates the thread list reactively.

**Recommendation:** Option A — keeps it simple, LLM slug gen with gpt-4o-mini is typically <1s.

---

### BUG-3: Query history saves entire editor buffer, not individual queries

**Screenshot:** ![history duplicates](ss — ⌘H shows 6 duplicate entries all "SELECT MIN(Date)..." at 14:43)  
**Severity:** HIGH

**Issue:** Multiple problems with query history:

1. **Whole-buffer saving:** When the editor contains 3 separate queries (SELECT MIN/MAX..., select * from 'train.csv'..., select * from 'features.csv'...) and user presses ⌘Enter, the *entire editor content* is saved as a single history entry — not the individual query that was executed. All 6 entries at 14:43 have the same preview because they're all the same multi-query buffer.

2. **Sidebar shows "no history":** The HISTORY section in the left sidebar only fetches when toggled open, never auto-refreshes after query execution.

3. **Agent queries not recorded:** When the agent runs `execute_query`, it's NOT saved to history at all — only user-executed queries via `/api/db/query` go through `save_history_entry`.

4. **No deduplication:** Running the same buffer 6 times creates 6 identical .sql files.

**Root Cause:** `db.py` passes `req.query` (the full POST body) to `save_history_entry()`. The editor sends the entire CodeMirror document — all statements concatenated — as a single string. There's no statement splitting or tracking of which statement the cursor is in.

**Verified on disk:**
```
~/.medha/history/2026-03-06/14-43-45_select_mindate_as_min_date.sql
# Contains ALL 3 queries from the editor, not just the one that ran
```

### BUG-4: Sidebar history shows "no history" — stale fetch

**Severity:** MEDIUM

**Issue:** The HISTORY section in the left sidebar (FileExplorer) shows "no history" even though the ⌘H popover in the editor shows entries.

**Root Cause:** Sidebar only fetches history when `historyOpen` toggles to `true`. No auto-refresh after queries execute.

**Proposed Fix:** Add a `historyVersion` counter to the Zustand store, increment it after each successful query. Sidebar's `useEffect` watches this counter and refetches.

---

## Features

### FEAT-1: Resizable bottom result pane (like terminal pane)

**Current state:** `ResultGrid` is constrained to `maxHeight: 40vh` — a fixed maximum. There's no drag handle to resize it.

**Requested behavior:** The result grid should behave like a terminal pane in VS Code:
- Fixed at bottom of the center panel
- **Resizable via drag handle** between editor and results (similar to the existing sidebar drag handles)
- Height persisted in state
- Minimum height ~100px, maximum ~80vh

**Proposed implementation:**
- Add a vertical drag handle between `SqlEditor` and `ResultGrid` in `App.tsx`
- Store `resultPaneHeight` in Zustand (default ~250px)
- Remove `maxHeight: 40vh` from ResultGrid, use exact height from state
- Reuse the same drag logic pattern as `handleDragStart` but for vertical axis

---

### FEAT-2: Click file → auto-preview data in result grid

**Screenshot:** ![TablePlus reference](ss5 — TablePlus showing table data on click)  
**Requested behavior:** When user clicks a file in the FileExplorer sidebar (e.g., `train.csv`), automatically:
1. Run `SELECT * FROM 'train.csv' LIMIT 100;` 
2. Populate the SQL editor with the query
3. Show results in the ResultGrid

This matches TablePlus behavior where clicking a table immediately shows its data.

**Proposed implementation:**
- Change `toggleActiveFile` behavior: single-click = preview data, toggle active state for agent context
- Or add a separate "preview" icon/action per file
- Call `handleExecute` with auto-generated SELECT query
- Update `editorContent` in store simultaneously

**Consideration:** Should differentiate between "select file for agent context" vs "preview file data". Options:
- **Single click = preview + select** (simplest, like TablePlus)
- **Single click = select, double-click = preview** (more control)
- **Click = select, eye icon = preview** (explicit)

---

### FEAT-3: Multi-tab SQL editor (like TablePlus query panes)

**Screenshot:** ![TablePlus SQL pane](ss6 — SQL editor with tab bar, multiple query tabs)  
**Requested behavior:** Support multiple SQL editor tabs:
- Tab bar above the editor showing open tabs
- Each tab has its own SQL content and can be independently executed
- New tab via `+` button or keyboard shortcut
- Close tab via `×` on tab  
- Tab names auto-derived from SQL content (first few words) or user-renamable
- Each tab's query result shows in the shared ResultGrid (last-executed wins)

**Proposed implementation:**
- New Zustand state: `tabs: TabState[]`, `activeTabId: string`
- Each `TabState`: `{ id, name, sql, queryResult? }`
- Tab bar component above SqlEditor
- SqlEditor content syncs with active tab's SQL
- `handleExecute` runs active tab's SQL, stores result on tab

---

### FEAT-4: Data/Structure/Chart tabs in result pane (like TablePlus)

**Screenshot:** ![TablePlus bottom tabs](ss6 — Data | Message | Chart tabs at bottom)  
**Requested behavior:** The result pane should have sub-tabs:
- **Data** (current ResultGrid — default)
- **Structure** (column names, types, nullability for the queried file)  
- **Chart** (basic visualization — bar, line, scatter from result data)

**Priority:** Data tab exists. Structure is useful. Chart is nice-to-have.

---

---

## Design: Query History & Editor Model

This section proposes a unified design for how queries are tracked, stored, and surfaced — addressing BUG-3, BUG-4, and the relationship between user queries, agent queries, and the editor.

### Current Problems (recap)

| Problem | Where |
|---------|-------|
| Whole editor buffer saved as one history entry | `db.py` → `save_history_entry(req.query)` |
| Agent queries (`execute_query` tool) not saved to history | `tools.py` doesn't call `save_history_entry` |
| Sidebar history never refreshes | `FileExplorer.tsx` fetches only on toggle |
| Same buffer saved N times with no dedup | No content-hash check |
| User query and agent query overwrite each other in the editor | Single `editorContent` in store |

### Proposed Architecture

#### 1. Statement-level history (not buffer-level)

**Change `handleExecute` in App.tsx** or the backend to save *individual statements*, not the full buffer:

**Option A — Backend splits:** Backend receives full text, splits on `;`, executes each, saves each individually. Requires changing `/api/db/query` to handle multi-statement.

**Option B — Frontend sends active statement only (Recommended):** The frontend determines which statement the cursor is in (or the full buffer if no cursor context) and sends only that statement to `/api/db/query`. This is how DataGrip/TablePlus work — "Run Current" vs "Run All".

**Why Option B is better:** DuckDB already handles single statements. The frontend knows cursor position. This also enables a future "Run Current ⌘↵" vs "Run All ⌘⇧↵" split.

#### 2. Agent query history

When the agent's `execute_query` tool runs a query, it should also be saved to history — but tagged as `source: "agent"` with the chat thread slug. This way:
- History shows ALL queries (user + agent)
- Each entry has a `source` field: `"user"` or `"agent"`  
- Agent entries include `thread_slug` for traceability

```python
# In tools.py execute_query
save_history_entry(
    sql=query,
    duration_ms=result["duration_ms"],
    row_count=result["row_count"],
    truncated=result.get("truncated", False),
    workspace_path=str(workspace_root) if workspace_root else "",
    source="agent",
    thread_slug=current_thread_slug,  # needs threading through
)
```

#### 3. Deduplication

Before saving, hash the SQL content (stripped of whitespace). If the same hash exists within the last N seconds (e.g., 10s), skip the save. Prevents the 6-duplicate-entries problem from spamming ⌘Enter.

#### 4. Editor model — user tabs vs agent overlay

Two separate concerns:
- **User's SQL tabs** (FEAT-3): User-written queries in tabs, persisted as `.sql` files or in-memory
- **Agent's query result**: When agent runs a query, it should NOT overwrite the user's editor tab. Instead:
  - Show the agent's SQL in the chat bubble (already done)
  - Push the result to the ResultGrid (already done via SSE)
  - Optionally: auto-create a new tab labeled "Agent: {slug}" with the agent's SQL — user can keep or discard

This keeps user work and agent work cleanly separated.

#### 5. History display improvements

- **⌘H popover and sidebar both show:** source indicator (👤 user / 🤖 agent), timestamp, row count, preview
- **Sidebar auto-refreshes** via Zustand `historyVersion` counter
- **Click on agent history entry:** loads the SQL AND shows the thread context

---

## Summary Table

| ID | Type | Severity | Description |
|----|------|----------|-------------|
| BUG-1 | Bug | HIGH | Agent blind to workspace files without manual selection |
| BUG-2 | Bug | MEDIUM | Chat slug shows timestamp, not LLM-generated name |
| BUG-3 | Bug | HIGH | History saves whole editor buffer, not individual queries; agent queries not saved |
| BUG-4 | Bug | MEDIUM | Sidebar history stale — never auto-refreshes |
| FEAT-1 | Feature | HIGH | Resizable result pane with drag handle |
| FEAT-2 | Feature | HIGH | Click file → auto-preview data in grid |
| FEAT-3 | Feature | MEDIUM | Multi-tab SQL editor |
| FEAT-4 | Feature | LOW | Structure + Chart tabs in result pane |

---

## Suggested Implementation Order

1. **BUG-1** (agent file awareness) — highest impact, simple backend fix
2. **BUG-3** (statement-level history + agent query recording) — foundational fix
3. **BUG-2** (slug generation) — improve inline slug gen
4. **BUG-4** (sidebar history auto-refresh) — Zustand counter, trivial
5. **FEAT-1** (resizable result pane) — foundational layout improvement
6. **FEAT-2** (click-to-preview) — core UX, matches TablePlus
7. **FEAT-3** (multi-tab editor) — significant, separates user/agent SQL
8. **FEAT-4** (structure/chart tabs) — polish, lower priority
