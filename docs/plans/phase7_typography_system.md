# Phase 7: Typography System — TDD Implementation Plan

**Date:** 2026-03-06
**Approach:** Test-first for CSS variable definition, then mechanical refactor per component
**Scope:** Frontend only — 96 inline fontSize declarations across 10 files

---

## Problem Summary

96 hardcoded `fontSize` values using 10 different sizes (8px-17px) scattered across 10 files. Same semantic role (e.g., "section header") uses different sizes in different panels. The chat sidebar is half the size of the left sidebar.

---

## The Type Scale

5-level scale using CSS custom properties in `:root`:

```css
--font-size-xs: 11px;     /* Metadata, timestamps, secondary info */
--font-size-sm: 12px;     /* Labels, section headers, buttons, captions */
--font-size-base: 14px;   /* Body text, file names, inputs, cells */
--font-size-md: 15px;     /* Primary content — chat messages, result cells */
--font-size-lg: 16px;     /* Editor code, emphasis, empty states */

--font-size-editor: 16px; /* CodeMirror root */
--font-size-gutter: 13px; /* CodeMirror line numbers */
```

---

## Semantic Mapping Rules

Every element maps to exactly one level based on its **semantic role**, regardless of which component it lives in:

| Role | Level | Variable | Examples |
|------|-------|----------|----------|
| **Metadata** | xs (11px) | `--font-size-xs` | Timestamps, file sizes, tool status, context pill text, history source icons, thread dates, code blocks |
| **Labels & Controls** | sm (12px) | `--font-size-sm` | Section headers (WORKSPACE, ASSISTANT, THREADS, HISTORY), buttons (NEW, CONFIGURE, medha-btn), role labels (YOU, MEDHA), toggle triangles, input placeholders, dismiss buttons, DiffOverlay controls |
| **Body Text** | base (14px) | `--font-size-base` | File names, thread names, inputs (workspace, chat, filter), toolbar buttons, result headers, status bars, empty states, browser paths, history entries (time), modal titles, banner text |
| **Content** | md (15px) | `--font-size-md` | Chat messages, result grid cells, error banners, history popover entries, file browser entries, workspace path input |
| **Emphasis** | lg (16px) | `--font-size-lg` | Editor root, header buttons (theme/settings), empty result states, body base |

---

## Step-by-Step Plan

### Step 1: Add CSS variables to index.css

Add the font-size scale variables to `:root` in `index.css`, right after the existing `--font-ui` declaration. No other changes.

**Test:** Snapshot test or manual assertion that the CSS variables exist.

### Step 2: Refactor component by component (biggest impact first)

Each component is a self-contained refactor. Replace inline `fontSize: N` with `fontSize: 'var(--font-size-*)'`.

**For inline React styles:** `fontSize: 'var(--font-size-sm)'`
**For CodeMirror theme objects:** `fontSize: 'var(--font-size-editor)'`
**For CSS files:** `font-size: var(--font-size-sm);`

#### Order and mapping:

---

#### 2a. ChatSidebar.tsx (16 occurrences — worst offender)

| Line | Current | New Variable | Rationale |
|------|---------|-------------|-----------|
| 232 | `10` | `--font-size-sm` | Section header |
| 244 | `9` | `--font-size-sm` | Label ("assistant") |
| 249 | `9` | `--font-size-sm` | Button ("new") |
| 264 | `10` | `--font-size-sm` | Section header ("threads") |
| 277 | `8` | `--font-size-xs` | Toggle triangle icon |
| 278 | `9` | `--font-size-sm` | Label ("threads") |
| 286 | `11` | `--font-size-base` | Empty state text |
| 308 | `11` | `--font-size-base` | Thread name |
| 318 | `9` | `--font-size-xs` | Thread date/model metadata |
| 346 | `11` | `--font-size-base` | Empty state "ask about your data" |
| 365 | `8` | `--font-size-sm` | Role label (YOU/MEDHA) |
| 378 | `12` | `--font-size-md` | Message content |
| 408 | `11` | `--font-size-xs` | Code block |
| 421 | `8` | `--font-size-xs` | "-> editor" button |
| 454 | `11` | `--font-size-xs` | Tool status indicator |
| 489 | `12` | `--font-size-base` | Chat input |

---

#### 2b. FileExplorer.tsx (26 occurrences)

| Line | Current | New Variable | Rationale |
|------|---------|-------------|-----------|
| 169 | `14` | `--font-size-sm` | Section header ("workspace") |
| 184 | `16` | `--font-size-md` | Prompt icon (">") |
| 206 | `15` | `--font-size-base` | Workspace path input |
| 257 | `14` | `--font-size-base` | File filter input |
| 273 | `15` | `--font-size-base` | "no files" empty state |
| 298 | `15` | `--font-size-base` | File list item |
| 323 | `13` | `--font-size-xs` | File size |
| 342 | `14` | `--font-size-sm` | Section header ("history") |
| 355 | `12` | `--font-size-sm` | Toggle triangle |
| 364 | `14` | `--font-size-base` | "no history" text |
| 383 | `14` | `--font-size-base` | History entry row |
| 393 | `11` | `--font-size-xs` | History source icon |
| 396 | `13` | `--font-size-xs` | History time |
| 405 | `13` | `--font-size-xs` | History SQL preview |
| 422 | `12` | `--font-size-sm` | "clear" button |
| 470 | `13` | `--font-size-sm` | Browse header |
| 485 | `14` | `--font-size-base` | "esc" button |
| 498 | `14` | `--font-size-base` | Current browse path |
| 514 | `14` | `--font-size-base` | "loading..." |
| 524 | `15` | `--font-size-base` | Parent dir ".." |
| 540 | `16` | `--font-size-md` | Up arrow icon |
| 556 | `15` | `--font-size-base` | Directory entry row |
| 571 | `15` | `--font-size-base` | Folder icon |
| 587 | `14` | `--font-size-base` | "empty directory" |
| 606 | `13` | `--font-size-sm` | "cancel" button |
| 614 | `13` | `--font-size-sm` | "select this folder" button |

---

#### 2c. SqlEditor.tsx (15 occurrences)

| Line | Current | New Variable | Rationale |
|------|---------|-------------|-----------|
| 174 | `"16px"` | `--font-size-editor` | CodeMirror root |
| 178 | `"17px"` | `--font-size-editor` | CodeMirror content (normalize to 16px) |
| 188 | `"13px"` | `--font-size-gutter` | CodeMirror gutters |
| 250 | `"14px"` | `--font-size-base` | CM search input |
| 258 | `"13px"` | `--font-size-sm` | CM search button |
| 360 | `14` | `--font-size-base` | Toolbar |
| 413 | `14px` | `--font-size-base` | Toolbar button (embedded CSS) |
| 445 | `15` | `--font-size-md` | Error banner text |
| 462 | `12` | `--font-size-sm` | Error dismiss button |
| 507 | `14` | `--font-size-base` | History popover header |
| 522 | `15` | `--font-size-base` | "esc" close button |
| 532 | `15` | `--font-size-base` | "loading..." |
| 537 | `15` | `--font-size-base` | "no history" |
| 558 | `15` | `--font-size-md` | History entry row |
| 568 | `12` | `--font-size-xs` | Source icon |
| 571 | `14` | `--font-size-xs` | History time |

---

#### 2d. App.tsx (10 occurrences)

| Line | Current | New Variable | Rationale |
|------|---------|-------------|-----------|
| 240 | `"14"` | SVG — keep as-is | SVG attribute, not CSS |
| 249 | `15` | `--font-size-md` | Subtitle/tagline |
| 265 | `16` | `--font-size-lg` | Theme toggle button |
| 280 | `16` | `--font-size-lg` | Settings button |
| 290 | `14` | `--font-size-base` | "duckdb" label |
| 311 | `14` | `--font-size-base` | Banner text |
| 327 | `13` | `--font-size-sm` | "Open Settings" button |
| 347 | `12` | `--font-size-sm` | Dismiss "x" button |
| 459 | `13` | `--font-size-sm` | Status bar text |
| 475 | `13` | `--font-size-sm` | Version text |

---

#### 2e. SettingsModal.tsx (9 occurrences)

| Line | Current | New Variable | Rationale |
|------|---------|-------------|-----------|
| 82 | `10` | `--font-size-sm` | Form labels |
| 93 | `12` | `--font-size-base` | Form inputs |
| 106 | `10` | `--font-size-sm` | Section titles |
| 206 | `10` | `--font-size-sm` | "fetch" button |
| 248 | `10` | `--font-size-xs` | Error message |
| 274 | `10` | `--font-size-xs` | Warning message |
| 339 | `11` | `--font-size-sm` | Modal title |
| 345 | `16` | `--font-size-lg` | Close button |
| 428 | `11` | `--font-size-xs` | Save status text |

---

#### 2f. ResultGrid.tsx (8 occurrences)

| Line | Current | New Variable | Rationale |
|------|---------|-------------|-----------|
| 35 | `16` | `--font-size-lg` | "running query..." |
| 55 | `16` | `--font-size-lg` | "Cmd+Enter to run" |
| 76 | `16` | `--font-size-lg` | "0 rows" empty state |
| 86 | `14` | `--font-size-base` | Duration display |
| 146 | `15` | `--font-size-md` | Table body |
| 162 | `14` | `--font-size-base` | Table header cells |
| 217 | `14` | `--font-size-base` | Status bar |
| 238 | `14` | `--font-size-base` | "TRUNCATED" label |

---

#### 2g. DiffOverlay.tsx (7 occurrences)

| Line | Current | New Variable | Rationale |
|------|---------|-------------|-----------|
| 137 | `11` | `--font-size-sm` | Title heading |
| 161 | `12` | `--font-size-base` | Instruction input |
| 175 | `11` | `--font-size-sm` | Submit button |
| 197 | `12` | `--font-size-xs` | Error message |
| 212 | `12` | `--font-size-sm` | Diff view code |
| 260 | `11` | `--font-size-sm` | "reject" button |
| 275 | `11` | `--font-size-sm` | "accept" button |

---

#### 2h. ContextPill.tsx (2 occurrences)

| Line | Current | New Variable | Rationale |
|------|---------|-------------|-----------|
| 50 | `10` | `--font-size-xs` | Pill label |
| 67 | `10` | `--font-size-xs` | Remove "x" button |

---

#### 2i. index.css (2 occurrences)

| Line | Current | New Variable | Rationale |
|------|---------|-------------|-----------|
| 90 | `16px` | `var(--font-size-lg)` | Body base font size |
| 180 | `13px` | `var(--font-size-sm)` | `.medha-btn` |

---

### Step 3: Visual verification

After all components use the scale, verify:
- Every section header is 12px (sm) regardless of panel
- Every body text is 14px (base)
- Every metadata is 11px (xs)
- Chat sidebar is no longer miniaturized

---

## Test Strategy

This is primarily a visual/CSS refactor — there's no behavioral logic to unit test. Testing strategy:

1. **Existing component tests must still pass** — we're only changing `fontSize` values, not component structure or behavior
2. **Verify CSS variables exist** — a simple test that loads `index.css` and checks for `--font-size-xs` through `--font-size-lg`
3. **No magic numbers** — grep for `fontSize:` + bare number should return 0 after refactor (except SVG attribute in App.tsx)

### Verification commands

```bash
# After refactor, this should return only the SVG line in App.tsx:
grep -rn "fontSize:" frontend/src/ | grep -v "var(--font-size" | grep -v "\.test\."

# Check CSS variables are defined:
grep "font-size-" frontend/src/index.css
```

---

## Execution Order

1. Add `--font-size-*` variables to `index.css` `:root` (and `[data-theme="light"]` — same values, typography doesn't change per theme)
2. Refactor ChatSidebar.tsx (biggest visual impact)
3. Refactor FileExplorer.tsx (most occurrences)
4. Refactor SqlEditor.tsx
5. Refactor App.tsx
6. Refactor SettingsModal.tsx
7. Refactor ResultGrid.tsx
8. Refactor DiffOverlay.tsx
9. Refactor ContextPill.tsx
10. Refactor index.css (body, .medha-btn)
11. Run existing frontend tests
12. Run verification grep — confirm no magic numbers remain

---

## Rules Going Forward

1. **No magic numbers** — every `fontSize` must use a `--font-size-*` variable
2. **5 levels only** — if you need a 6th, you're wrong about the semantic role
3. **Same role = same size** — "section header" is always `sm`, regardless of panel
4. **ChatSidebar is a peer panel** — not a tooltip. It should use the same scale as the rest of the UI.

---

## File Changes Summary

| File | Occurrences | Change Type |
|------|-------------|-------------|
| `frontend/src/index.css` | 2 + new vars | Add CSS variables, refactor existing |
| `frontend/src/components/ChatSidebar.tsx` | 16 | Replace inline fontSize |
| `frontend/src/components/FileExplorer.tsx` | 26 | Replace inline fontSize |
| `frontend/src/components/SqlEditor.tsx` | 15 | Replace inline fontSize + CM theme |
| `frontend/src/App.tsx` | 9 (1 SVG kept) | Replace inline fontSize |
| `frontend/src/components/SettingsModal.tsx` | 9 | Replace inline fontSize + style objects |
| `frontend/src/components/ResultGrid.tsx` | 8 | Replace inline fontSize |
| `frontend/src/components/DiffOverlay.tsx` | 7 | Replace inline fontSize |
| `frontend/src/components/ContextPill.tsx` | 2 | Replace inline fontSize |
| **Total** | **95** (1 SVG kept) | |
