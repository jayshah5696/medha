# Medha Phase 6 UI and Agent Audit

> **Status:** ✅ All 4 critical bugs RESOLVED (2026-03-06)  
> **Session log:** [docs/sessions/2026-03-06_phase6-audit-fixes.md](../sessions/2026-03-06_phase6-audit-fixes.md)  
> **Decisions:** [docs/decisions/](../decisions/)

This document details the critical UX and agent execution bugs discovered during the visual pass of Medha v0.1. Each issue includes the root cause and the resolution applied.

---

## 1. Logo Visibility Inversion (BUG-UI-1) — ✅ RESOLVED

**Issue:** The Medha logo is completely invisible in the top-left corner of the application when the app boots in Dark Mode.

**Root Cause:** The image path logic in `App.tsx` was backwards AND the PNGs had opaque backgrounds. Dark logo on dark theme = invisible.

**Resolution:** Replaced both PNG `<img>` tags with a single **inline SVG** using `fill: var(--accent)`. Automatically adapts to any theme. See [ADR-001](../decisions/ADR-001-svg-logo.md).

**File:** `frontend/src/App.tsx`

---

## 2. Inadequate Baseline Typography Extents (BUG-UI-2) — ✅ RESOLVED

**Issue:** Application typography is unreadable on standard desktop resolutions without explicitly zooming the browser to 175%.

**Root Cause:** CSS variables and fixed pixel sizes defined `10px` for UI elements and `13px` for the code editor — significantly below modern baselines (14–16px).

**Resolution:** Multiple rounds of font-size bumps across all components. Final targets designed for **150% zoom readability**:

| Element | Before | After |
|---------|--------|-------|
| Body | 13px | 16px |
| SQL Editor | 13px | 17px |
| Table headers | 10px | 13px |
| Table cells | 12px | 15px |
| Status bars | 10px | 12px |
| Chat messages | 12px | 15px |
| File explorer | 12px | 14px |

**Files:** `index.css`, `App.tsx`, `SqlEditor.tsx`, `ResultGrid.tsx`, `FileExplorer.tsx`, `ChatSidebar.tsx`

---

## 3. Web FileSystem API Path Illusion (BUG-ARCH-1) — ✅ RESOLVED

**Issue:** Selecting a folder via the browser's native directory picker caused all SQL to fail.

**Root Cause:** `showDirectoryPicker()` only returns the leaf folder name (e.g., `"SyntheticData"`), not the absolute path. Backend requires absolute path for workspace sandbox.

**Resolution:** Removed native directory picker. Built a **backend-powered folder browser** via `POST /api/workspace/browse` with modal UI for navigation. See [ADR-004](../decisions/ADR-004-backend-folder-browser.md).

**Files:** `FileExplorer.tsx`, `api.ts`, `workspace.py`  
**Tests added:** 7 FileExplorer tests, 2 API tests

---

## 4. Agent File Extension Hallucination (BUG-AI-1) — ✅ RESOLVED

**Issue:** Agent queries `data/sites` instead of `data/sites.csv` — hallucinating filenames without extensions.

**Root Cause:** System prompts in agent YAML profiles did not mandate strict filename adherence.

**Resolution:** Hardened all 3 agent YAML profiles (`default.yaml`, `fast.yaml`, `deep.yaml`) with strict filename+extension rules and correct/incorrect examples.

**Files:** `backend/agents/default.yaml`, `fast.yaml`, `deep.yaml`

---

## Additional Fixes Implemented (Same Session)

| Fix | Description | ADR |
|-----|-------------|-----|
| Active files context | Frontend sends `active_files[]` → agent prepends to user message | — |
| FILE_SEARCH_PATH | `set_workspace()` calls `SET FILE_SEARCH_PATH` for relative path resolution | [ADR-002](../decisions/ADR-002-file-search-path.md) |
| Query result sync | Agent query results auto-populate editor + result grid via SSE | [ADR-003](../decisions/ADR-003-query-result-sync.md) |
| JSON serialization | `_serialize_value()` handles DuckDB types (date, Decimal, UUID, bytes, timedelta) | — |
| Meta config | `model_slug` + `last_workspace` fields in Settings | [ADR-005](../decisions/ADR-005-meta-config-slug-model.md) |
| Cmd+Enter keymap | `Prec.highest()` fix for CodeMirror Run shortcut | — |
