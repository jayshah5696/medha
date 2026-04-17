# Immediate Product Improvements

**Date:** 2026-04-17  
**Status:** Core features implemented ✅  
**Priority:** These are P0/P1 table-stakes features every SQL IDE has. Ship ASAP.

---

## 1. Schema-Aware Autocomplete ✅
**Priority: P0 | Effort: 1 day | Impact: Biggest UX gap | Status: DONE (v0.4.0)**

### Current State
- CodeMirror `sql()` provides keyword-only highlighting (SELECT, FROM, WHERE...)
- No awareness of actual table/column names from workspace files
- Backend already has `/api/db/schema/{filename}` returning column names + types

### Implementation
1. **Frontend:** On workspace load (and file change events), fetch schemas for all files
2. **Store:** Add `schemaMap: Record<string, SchemaColumn[]>` to Zustand store
3. **CodeMirror:** Pass schema to `sql()` config:
   ```typescript
   sql({
     dialect: DuckDBDialect,  // or generic SQL
     schema: {
       "employees.csv": ["id", "name", "department", "salary"],
       "orders.csv": ["order_id", "customer", "amount", "date"],
     }
   })
   ```
4. **Auto-refresh:** When `file_changed` SSE event fires, refetch that file's schema

### Tests (TDD)
- Test that store fetches schemas on workspace configure
- Test that CodeMirror receives updated schema config
- Test that schema refreshes on file change event

---

## 2. Column Sorting in Result Grid ✅
**Priority: P0 | Effort: 4 hours | Impact: Expected by every user | Status: DONE (v0.4.0)**

### Current State
- TanStack Table is configured but sorting is not enabled
- Column headers are not clickable

### Implementation
1. **Enable sorting:** Add `getSortedRowModel()` to table options
2. **Column headers:** Make clickable with sort indicator (▲/▼/none)
3. **Client-side:** Sort the loaded page of data. For full-dataset sort, re-execute query with `ORDER BY` appended
4. **Visual:** Show sort direction indicator in header, subtle hover state

### Tests (TDD)
- Test clicking column header toggles sort state in store
- Test sorted data matches expected order
- Test sort indicator renders correctly

---

## 3. Copy to Clipboard ✅
**Priority: P0 | Effort: 4 hours | Impact: Core workflow | Status: DONE (v0.4.1)**

### Current State
- Only CSV/Parquet file export exists
- No way to copy a cell value, row, or selection

### Implementation
1. **Cell click:** Select cell, show subtle highlight
2. **Cmd+C on cell:** Copy cell value as plain text
3. **Row selection:** Click row number to select row, Shift+click for range
4. **Cmd+C on rows:** Copy as TSV (pastes cleanly into Excel/Sheets)
5. **Right-click context menu:** Copy cell / Copy row as JSON / Copy column
6. **Header right-click:** Copy entire column values

### Tests (TDD)
- Test cell selection state in store
- Test TSV formatting of selected rows
- Test clipboard API called with correct content

---

## 4. Execute Selected SQL Only ✅
**Priority: P1 | Effort: 3 hours | Impact: Power user workflow | Status: DONE (v0.4.1)**

### Current State
- Cmd+Enter always executes the entire editor content
- No way to run just a portion of a multi-statement file

### Implementation
1. **Detection:** On Cmd+Enter, check if CodeMirror has an active selection
2. **If selected:** Execute only the selected text
3. **If not selected:** Execute the full editor content (current behavior)
4. **Visual feedback:** Brief highlight of the executed region
5. **Status bar:** Show "Executed selection" vs "Executed query"

### Tests (TDD)
- Test that selection triggers partial execution
- Test that no selection triggers full execution
- Test that selected text is sent to the query endpoint

---

## 5. Command Palette (Cmd+Shift+P) ✅
**Priority: P1 | Effort: 1 day | Impact: Discoverability + power user feel | Status: DONE (v0.4.1)**

### Current State
- Keyboard shortcuts shown in toolbar text but not searchable
- No central place to discover all actions

### Implementation
1. **Overlay:** Modal with search input, fuzzy-filtered action list
2. **Actions registry:** Array of `{ label, shortcut, action, category }` objects
3. **Categories:** File, Edit, View, Query, AI, Settings
4. **Key binding:** Cmd+Shift+P (or Cmd+P with no file open)
5. **Actions include:**
   - Run Query (Cmd+Enter)
   - Format SQL (Cmd+Shift+F)
   - Save Query (Cmd+S)
   - New Tab (Cmd+T)
   - Close Tab (Cmd+W)
   - Open Settings (Cmd+,)
   - Toggle Chat (Cmd+L)
   - Inline Edit (Cmd+K)
   - Open History (Cmd+H)
   - Export CSV / Export Parquet
   - Toggle Theme

### Tests (TDD)
- Test palette opens on shortcut
- Test fuzzy filtering works
- Test action execution triggers correct handler

---

## 6. Column Type Indicators ✅
**Priority: P2 | Effort: 2 hours | Impact: Data comprehension | Status: DONE (v0.4.1)**

### Current State
- Column headers show name only
- No indication of data type (integer, varchar, date, etc.)

### Implementation
1. **Type badge:** Small type indicator next to column name (e.g., `INT`, `TEXT`, `DATE`)
2. **Color coding:** Subtle color per type family (numbers: blue, strings: green, dates: purple)
3. **Source:** DuckDB already returns type info via `result.description`; pass through to frontend

### Tests (TDD)
- Test that type info is included in query response
- Test that type badges render for each column

---

## Implementation Order

```
Week 1:
  Day 1: Schema-aware autocomplete (#1)
  Day 2: Column sorting (#2) + Copy to clipboard (#3)
  Day 3: Execute selected SQL (#4) + Column types (#6)
  
Week 2:
  Day 1-2: Command palette (#5)
```

All items follow TDD: write the failing test first, then implement, then verify with `vitest` + `pytest` + `build`.

---

## What NOT to Build Yet

- **Multi-statement execution** — Complex (statement splitting, multiple result tabs). Do after the basics work.
- **Query plan visualization** — Nice but not table-stakes. Save for v0.6+.
- **SQL snippets/templates** — Power user feature, not core workflow.
- **Inline SQL linting** — Would need sqlglot integration in frontend. Later.
