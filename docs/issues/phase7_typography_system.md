# Phase 7: Typography System — Consistent Font Scale

**Date:** 2026-03-06  
**Status:** 📋 Documented — awaiting confirmation  
**Severity:** MEDIUM — visual inconsistency, feels unpolished

---

## The Problem

The UI has **92 inline `fontSize` declarations** using **10 different sizes** (8px through 17px) scattered across 9 components. There is no type scale — sizes were added ad hoc during incremental bumps. The result is visually inconsistent: the same semantic role (e.g., "section label") uses different sizes depending on which component it's in.

### Current Font Size Census

| Size | Count | Where |
|------|-------|-------|
| 8px | 3 | ChatSidebar (role labels, "→ editor" button, thread toggle arrow) |
| 9px | 4 | ChatSidebar ("assistant", "threads" labels, NEW button) |
| 10px | 9 | ChatSidebar (header), ContextPill, SettingsModal (labels, errors) |
| 11px | 12 | ChatSidebar (thread names, empty state, tool status), DiffOverlay, SettingsModal |
| 12px | 11 | ChatSidebar (messages, input), FileExplorer (toggle arrows, clear btn, history time), DiffOverlay, App (banner dismiss) |
| 13px | 11 | App (status bar, banner font, settings btn), SqlEditor (gutters, CM search), FileExplorer (file sizes, history preview, browse buttons), index.css (.medha-btn) |
| 14px | 19 | App (header text, SVG), SqlEditor (toolbar, history header, timestamps), ResultGrid (headers, status, empty states), FileExplorer (labels, history, filter, browse) |
| 15px | 13 | App (tagline), SqlEditor (error, history entries, history popover items), ResultGrid (table cells), FileExplorer (file names, workspace input, browse entries) |
| 16px | 9 | App (theme/settings buttons), SqlEditor (CM root), ResultGrid (empty states), FileExplorer (prompt icon, browse ↑), index.css (body) |
| 17px | 1 | SqlEditor (CM content / actual code) |

### Visual Evidence from Screenshot

Looking at the screenshot left-to-right:

| Element | Current Size | Visual Issue |
|---------|-------------|--------------|
| "WORKSPACE" label | 14px | OK but inconsistent with "ASSISTANT" (10px) and "THREADS" (10px) on right |
| Workspace path input | 15px | Larger than file names below it |
| "CONFIGURE" button | 13px (.medha-btn) | Different from toolbar buttons (14px) |
| File names (features.csv) | 15px | Good size but different weight than thread names |
| File sizes (533.0 KB) | 13px | OK |
| "HISTORY" label | 14px | Different from "THREADS" (10px → 9px actual) on the right! |
| SQL editor code | 17px | Largest text on screen — intentional |
| Toolbar (⌘H History...) | 14px class | Fine |
| "ASSISTANT" label | 9px actual | **Way too small** — half the size of "WORKSPACE" |
| "NEW" button | 9px | Tiny |
| Thread name (count-available-stores) | 11px | Smaller than file names (15px) — should be same |
| Thread date/model | 9px | Too small |
| "ask about your data" placeholder | 11px | Different from chat input (12px) |
| Chat input "ask..." | 12px | Different from workspace path input (15px) |
| Context pills (schema: stores.csv) | 10px | Too small |
| Result grid headers (STORE) | 14px | Fine |
| Result grid cells (1, 2, 3) | 15px | Fine |
| Status bar (45 rows · 16.09ms) | 14px | Fine |
| Bottom status bar (workspace path) | 13px | Slightly smaller than result status bar |

**The most jarring mismatch:** "WORKSPACE" (14px) vs "ASSISTANT"/"THREADS" (9px). These are the same semantic role (section header) but the right sidebar is **half the size** of the left.

---

## Proposed Type Scale

A 5-level scale using CSS custom properties. Every text element maps to exactly one level:

```css
:root {
  /* Typography scale — 5 levels */
  --font-size-xs: 11px;    /* Metadata, timestamps, secondary info */
  --font-size-sm: 12px;    /* Labels, section headers, buttons, captions */
  --font-size-base: 14px;  /* Body text, file names, thread names, inputs, cells */
  --font-size-md: 15px;    /* Primary content — chat messages, result cells */
  --font-size-lg: 16px;    /* Editor code, emphasis */
  
  /* Editor gets its own since it's the primary workspace */
  --font-size-editor: 16px;
  --font-size-gutter: 13px;
}
```

### Mapping: Element → Scale Level

| Scale Level | Variable | Elements |
|-------------|----------|----------|
| **xs** (11px) | `--font-size-xs` | Timestamps (history, threads), tool status, "running" indicator, context pill text, file sizes, secondary metadata |
| **sm** (12px) | `--font-size-sm` | Section headers ("WORKSPACE", "ASSISTANT", "THREADS", "HISTORY"), buttons (NEW, CONFIGURE, medha-btn), input placeholders, banner dismiss, role labels ("YOU", "MEDHA") |
| **base** (14px) | `--font-size-base` | File names, thread names, input fields (workspace path, chat input, file filter), toolbar buttons, result grid headers, status bars, empty states |
| **md** (15px) | `--font-size-md` | Chat message content, result grid cells, error banners, history popover entries |
| **lg** (16px) | `--font-size-lg` | Editor code (`.cm-content`), header tagline, body base |

### What Changes

The biggest visual fixes:

| Element | Before | After | Change |
|---------|--------|-------|--------|
| "ASSISTANT" header | 9px | 12px (sm) | **+3px** — matches "WORKSPACE" |
| "THREADS" header | 9px | 12px (sm) | **+3px** — matches "HISTORY" |
| "NEW" button | 9px | 12px (sm) | **+3px** — readable |
| Thread toggle arrow | 8px | 11px (xs) | **+3px** |
| Thread names | 11px | 14px (base) | **+3px** — matches file names |
| Thread date/model | 9px | 11px (xs) | **+2px** |
| Chat role labels | 8px | 12px (sm) | **+4px** |
| Chat messages | 12px | 15px (md) | **+3px** |
| Chat input | 12px | 14px (base) | **+2px** — matches workspace input |
| Context pills | 10px | 11px (xs) | **+1px** |
| "→ editor" button | 8px | 11px (xs) | **+3px** |
| Empty state "ask about your data" | 11px | 14px (base) | **+3px** |
| SettingsModal labels | 10px | 12px (sm) | **+2px** |
| SettingsModal inputs | 12px | 14px (base) | **+2px** |
| DiffOverlay text | 11-12px | mixed xs/sm | Normalized |

### What Stays the Same
- Editor code: 16–17px (already good, use `--font-size-lg`)
- Result grid cells: 15px (already `--font-size-md`)
- File names: 15px → 14px (minor adjustment to `--font-size-base`)
- Toolbar: 14px (already `--font-size-base`)

---

## Implementation Plan

### Step 1: Define CSS variables in `index.css`

Add the scale variables to `:root`. Don't change anything else yet.

### Step 2: Refactor component by component

For each component, replace all inline `fontSize: N` with the appropriate CSS variable. This is mechanical — the mapping table above defines every substitution.

**Order:** ChatSidebar (worst offender) → ContextPill → SettingsModal → DiffOverlay → FileExplorer → App.tsx → SqlEditor → ResultGrid

### Step 3: Verify visually

After all components use the scale, every section header should be 12px, every body text 14px, every metadata 11px. The UI should look uniform left-to-right.

---

## Rules Going Forward

1. **No magic numbers** — every `fontSize` must use a `--font-size-*` variable
2. **5 levels only** — if you need a 6th, you're probably wrong about the semantic role
3. **Same role = same size** — "section header" is always `sm`, "body text" is always `base`, regardless of which panel it's in
4. **ChatSidebar should not be a miniature UI** — it's a peer panel, not a tooltip
