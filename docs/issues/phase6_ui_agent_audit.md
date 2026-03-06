# Medha Phase 6 UI and Agent Audit

This document details the critical UX and agent execution bugs discovered during the visual pass of Medha v0.1. Each issue includes the root cause and the required architectural or UI code changes to correct it.

## 1. Logo Visibility Inversion (BUG-UI-1)
**Issue:** The Medha logo is completely invisible in the top-left corner of the application when the app boots in Dark Mode.
**Root Cause:** The image path logic in `App.tsx` is backwards. Wait, it currently states:
`src={theme === "dark" ? "/logo-dark.png" : "/logo-light.png"}`
This means when the app is dark (black background), we are loading the dark/black logo. Black-on-black renders it invisible.
**Solution:**
In `frontend/src/App.tsx:125`:
```tsx
- src={theme === "dark" ? "/logo-dark.png" : "/logo-light.png"}
+ src={theme === "dark" ? "/logo-light.png" : "/logo-dark.png"}
```

## 2. Inadequate Baseline Typography Extents (BUG-UI-2)
**Issue:** Application typography is unreadable on standard desktop resolutions without explicitly zooming the browser to 175%.
**Root Cause:** The CSS variables and fixed pixel sizes in `index.css` define `10px` for UI elements and `13px` for the core code editor. This is significantly below modern application baselines (14px-16px).
**Solution:**
In `frontend/src/index.css`:
- `body { font-size: 14px; }` (Up from 13px)
In `frontend/src/components/SqlEditor.tsx`:
- `.cm-content { font-size: 15px; }` (Up from 13px)
In `frontend/src/components/ResultGrid.tsx`:
- Upgrade `th` font size from `10px` to `12px`
- Upgrade `td` font size from `12px` to `14px`
- Status bar size from `10px` to `11px`

## 3. Web FileSystem API Path Illusion (BUG-ARCH-1)
**Issue:** Selecting a folder via the application's native directory picker icon causes all SQL, even unrelated queries like `SELECT 1;`, to fail.
**Root Cause:** For security reasons, the browser's `showDirectoryPicker()` API intentionally hides the true absolute path of the selected directory from the web application. It only returns the leaf folder name (e.g. `SyntheticData`).
When the user clicks "Configure", `frontend/src/components/FileExplorer.tsx` sends the relative string `"SyntheticData"` to the `/api/workspace/configure` endpoint.
The backend's path-safety sandbox (`backend/app/db.py:_check_path_safety`) enforces that all DuckDB reads occur inside an absolute `workspace_root`. Because the root was set to a relative, unreachable location, the safety check trips and locks the database.
**Solution:**
The native folder picker is inherently incompatible with Medha's backend architecture which fundamentally requires the absolute URL path string to route disk queries.
The folder picker button must be removed entirely from the UI, and the user must paste the absolute path.
In `frontend/src/components/FileExplorer.tsx:170`, delete:
```tsx
{hasDirPicker && (
  <button onClick={handleBrowse}>...</button>
)}
```

## 4. Agent File Extension Hallucination (BUG-AI-1)
**Issue:** When instructed to query `data/sites`, the LangGraph agent hallucinates a `SELECT * FROM 'data/sites'` query, ignoring the actual file on disk which is `data/sites.csv`. The operation fails because the extensionless file does not exist.
**Root Cause:** The `system_prompt` in `agents/default.yaml` tells the agent to query flat files but does not mandate strict adherence to the fully qualified extensions provided in the Active Files Context pills.
**Solution:**
Harden the prompt engineering in `agents/default.yaml` to instruct the model to append proper file extensions.
Add: "You MUST query the exact full filename including the extension (e.g. 'data/sites.csv' not 'data/sites') as provided by the user's active file selection."
