# Electron Desktop Shell — Implementation Plan

**Replaces:** Tauri (Rust) shell from SPEC.md sections 6, 14C, 16B
**Status:** Phase 1-3 implemented (scaffold, sidecar, IPC + frontend integration)

---

## 1. Why Electron over Tauri

- No Rust toolchain required — the team already works in TypeScript and Python.
- Mature ecosystem for sidecar management (child_process), auto-update (electron-updater), and packaging (electron-builder).
- Larger pool of examples for "Electron + Python sidecar" pattern.
- Trade-off accepted: larger binary (~150 MB vs ~15 MB for Tauri). Acceptable for a local-first SQL IDE.

---

## 2. Directory Structure

```
medha/
  electron/
    main.ts              # Electron main process entry
    preload.ts           # contextBridge exposures for renderer
    sidecar.ts           # Python backend lifecycle (spawn, health, shutdown)
    port.ts              # Free port finder (18900-18999)
    ipc-handlers.ts      # IPC handler registrations (pick_directory, get_port, etc.)
    tsconfig.json        # Main-process TS config (target: ESNext, module: CommonJS)

  electron-builder.yml   # electron-builder config (lives at repo root)

  frontend/              # (existing — no changes to source, only build output consumed)
    dist/                # Vite static build loaded by BrowserWindow

  backend/               # (existing)
    medha.spec           # PyInstaller spec (already referenced in SPEC.md)
    dist/
      medha-backend      # PyInstaller single-binary output
```

The `electron/` folder is a sibling to `frontend/` and `backend/`, not nested inside either.

---

## 3. Key Files

### 3A. `electron/main.ts`

Responsibilities:
- Create BrowserWindow loading `frontend/dist/index.html` (via `file://` protocol)
- Register all IPC handlers (from `ipc-handlers.ts`)
- On `app.ready`: start sidecar, wait for health, then show window
- On `app.before-quit` / `window-all-closed`: trigger graceful sidecar shutdown
- In dev mode: load `http://localhost:5173` instead of static build (detect via `ELECTRON_DEV` env var)
- Set `webPreferences.preload` to the compiled preload script
- Inject the backend port into the renderer via IPC (renderer calls `window.electronAPI.getPort()`)

Window config:
- `width: 1400, height: 900, minWidth: 900, minHeight: 600`
- `titleBarStyle: 'hiddenInset'` on macOS (native traffic lights)
- `backgroundColor: '#0a0a0b'` (matches app theme, prevents white flash)

### 3B. `electron/preload.ts`

Exposes a minimal API via `contextBridge.exposeInMainWorld('electronAPI', ...)`:

```typescript
interface ElectronAPI {
  pickDirectory(): Promise<string | null>;
  getPort(): Promise<number>;
  getPlatform(): string;
  onBackendReady(callback: () => void): void;
  onBackendError(callback: (error: string) => void): void;
}
```

No direct Node.js APIs exposed to renderer. All communication through these typed channels.

### 3C. `electron/sidecar.ts`

Exports:
- `spawnBackend(port: number): ChildProcess` — spawns the PyInstaller binary (or `uv run uvicorn` in dev mode) with `--port` argument and `MEDHA_PORT` env var
- `waitForHealth(port: number, timeoutMs: number): Promise<void>` — polls `GET http://localhost:{port}/health` every 200ms, rejects after timeout (default 15s)
- `shutdownBackend(child: ChildProcess): Promise<void>` — sends SIGTERM, waits 3s, then SIGKILL if still alive. On Windows: uses `child.kill()` which sends `taskkill`.

Binary resolution logic:
1. **Packaged app:** `path.join(process.resourcesPath, 'sidecar', 'medha-backend')` (copied by electron-builder `extraResources`)
2. **Dev mode:** spawn `uv run uvicorn app.main:app --port {port}` with cwd set to `backend/`

Stdout/stderr of the child process piped to a log file at `app.getPath('logs')/backend.log`.

### 3D. `electron/port.ts`

Exports:
- `findFreePort(rangeStart: number, rangeEnd: number): Promise<number>` — tries to bind a TCP server on each port in range 18900-18999, returns the first that succeeds, then closes the server. Pure Node.js `net.createServer` approach (no npm dependency needed).

### 3E. `electron/ipc-handlers.ts`

Registers all `ipcMain.handle` calls in one place:

| Channel | Handler | Returns |
|---------|---------|---------|
| `pick-directory` | `dialog.showOpenDialog({ properties: ['openDirectory'] })` | `string \| null` (selected path or null if cancelled) |
| `get-port` | Returns the port number determined at startup | `number` |
| `get-platform` | Returns `process.platform` | `string` |
| `show-save-dialog` | `dialog.showSaveDialog(...)` for future export features | `string \| null` |
| `get-app-version` | Returns `app.getVersion()` | `string` |

---

## 4. Frontend Changes

Minimal changes to existing frontend code. The goal is for the same frontend build to work in both web (Vite dev server) and Electron (BrowserWindow).

### 4A. API Base URL

Currently all fetch calls use relative URLs (`/api/...`), which works because Vite proxies to `:18900`. In Electron there is no proxy — the frontend loads from `file://` and needs to hit `http://localhost:{port}/api/...`.

**Approach:** Add a base URL resolver in `frontend/src/lib/api.ts`:

```typescript
function getApiBase(): string {
  if (window.electronAPI) {
    // Port injected by Electron preload
    return `http://localhost:${window.__MEDHA_PORT__}`;
  }
  return '';  // relative URLs, Vite proxy handles it
}
```

The port is set on `window.__MEDHA_PORT__` by the main process via `webContents.executeJavaScript` after the backend is healthy, OR the renderer fetches it via `window.electronAPI.getPort()` on startup.

All `fetch` calls in `api.ts` prepend `getApiBase()`. The `EventSource` URL for `/api/events` also needs the base.

### 4B. Directory Picker Integration

Update the workspace folder picker component to detect Electron:

```typescript
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
if (isElectron) {
  const path = await window.electronAPI.pickDirectory();
  if (path) configureWorkspace(path);
}
```

This replaces the `__TAURI__` detection currently described in SPEC.md section 14C/16C.

### 4C. TypeScript Declarations

Add `frontend/src/types/electron.d.ts`:

```typescript
interface ElectronAPI {
  pickDirectory(): Promise<string | null>;
  getPort(): Promise<number>;
  getPlatform(): string;
  onBackendReady(callback: () => void): void;
  onBackendError(callback: (error: string) => void): void;
}

interface Window {
  electronAPI?: ElectronAPI;
  __MEDHA_PORT__?: number;
}
```

---

## 5. Package Configuration

### 5A. Root `package.json` additions

The repo currently has no root `package.json`. Create one (or add to `electron/package.json`) with:

```json
{
  "name": "medha",
  "version": "0.1.0",
  "private": true,
  "main": "electron/dist/main.js",
  "scripts": {
    "electron:dev": "ELECTRON_DEV=1 electron electron/dist/main.js",
    "electron:build": "tsc -p electron/tsconfig.json",
    "electron:pack": "electron-builder --dir",
    "electron:dist": "electron-builder"
  },
  "devDependencies": {
    "electron": "^35.0.0",
    "electron-builder": "^26.0.0",
    "typescript": "^5.9.0"
  },
  "dependencies": {}
}
```

No runtime npm dependencies — Electron itself is a devDependency. The sidecar is a standalone binary.

### 5B. `electron-builder.yml`

```yaml
appId: com.medha.app
productName: Medha
copyright: Copyright 2026

directories:
  output: release
  buildResources: build

files:
  - electron/dist/**/*
  - frontend/dist/**/*

extraResources:
  - from: backend/dist/medha-backend
    to: sidecar/medha-backend

mac:
  category: public.app-category.developer-tools
  icon: docs/brand/icon.icns
  target:
    - target: dmg
      arch: [universal]
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist

# Future
win:
  target: nsis
  icon: docs/brand/icon.ico

linux:
  target: AppImage
  category: Development
```

### 5C. macOS Entitlements

`build/entitlements.mac.plist` — needed because we spawn a child process:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.automation.apple-events</key>
  <true/>
</dict>
</plist>
```

---

## 6. Build Pipeline

### 6A. PyInstaller Binary

The backend is bundled into a single binary via PyInstaller. A `backend/medha.spec` file (referenced in SPEC.md but not yet created) defines the build:

- Entry point: `backend/app/main.py` (with a `__main__` block that runs uvicorn)
- Hidden imports: `duckdb`, `pyarrow`, `watchfiles`, `litellm` (these have compiled extensions that PyInstaller can miss)
- `--onefile` mode for single binary output
- Output: `backend/dist/medha-backend`

The backend `app/main.py` needs a `__main__` guard:

```python
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("MEDHA_PORT", "18900"))
    uvicorn.run("app.main:app", host="127.0.0.1", port=port)
```

The port comes from the `MEDHA_PORT` env var set by Electron's sidecar spawner.

### 6B. Full Build Sequence

```
1. cd backend && uv run pyinstaller medha.spec
   -> produces backend/dist/medha-backend

2. cd frontend && npm run build
   -> produces frontend/dist/

3. cd electron && npx tsc -p tsconfig.json
   -> produces electron/dist/main.js, preload.js, etc.

4. npx electron-builder
   -> reads electron-builder.yml
   -> copies frontend/dist/ into app resources
   -> copies backend/dist/medha-backend into extraResources/sidecar/
   -> produces release/Medha-{version}.dmg
```

### 6C. Dev Mode

For development, no PyInstaller binary is needed:

```
Terminal 1: just backend                        # uvicorn on :18900
Terminal 2: just frontend                       # Vite on :5173
Terminal 3: ELECTRON_DEV=1 npx electron .       # loads localhost:5173
```

In dev mode, `sidecar.ts` skips spawning — the developer runs the backend manually. The Electron window connects to `localhost:5173` (Vite HMR) which proxies API calls to `localhost:18900`.

---

## 7. IPC API Surface

### 7A. Renderer -> Main (invoke/handle pattern)

| Channel | Args | Returns | Purpose |
|---------|------|---------|---------|
| `pick-directory` | none | `string \| null` | Native OS folder picker |
| `get-port` | none | `number` | Backend port for API calls |
| `get-platform` | none | `string` | `darwin` / `win32` / `linux` |
| `show-save-dialog` | `{ defaultPath: string, filters: FileFilter[] }` | `string \| null` | Native save dialog for exports |
| `get-app-version` | none | `string` | App version from package.json |
| `get-log-path` | none | `string` | Path to backend.log for debugging |

### 7B. Main -> Renderer (event pattern)

| Channel | Payload | Purpose |
|---------|---------|---------|
| `backend-ready` | `{ port: number }` | Backend health check passed |
| `backend-error` | `{ error: string }` | Backend failed to start or crashed |
| `backend-stderr` | `{ line: string }` | Real-time backend log lines (dev mode) |

---

## 8. Sidecar Lifecycle Detail

### 8A. Startup Sequence

```
app.ready
  |-> findFreePort(18900, 18999)
  |-> spawnBackend(port)
  |     |-> set env MEDHA_PORT={port}
  |     |-> spawn binary (or uv run in dev)
  |     |-> pipe stdout/stderr to log file
  |-> waitForHealth(port, 15000)
  |     |-> GET http://127.0.0.1:{port}/health every 200ms
  |     |-> resolve when response is {"ok": true}
  |     |-> reject after 15s timeout
  |-> createBrowserWindow()
  |     |-> load frontend/dist/index.html (or localhost:5173 in dev)
  |-> webContents.send('backend-ready', { port })
```

If `waitForHealth` rejects, show an error dialog with the last 50 lines of `backend.log` and offer to retry or quit.

### 8B. Shutdown Sequence

```
app.before-quit / window-all-closed
  |-> child.kill('SIGTERM')
  |-> setTimeout(3000)
  |     |-> if child still alive: child.kill('SIGKILL')
  |-> app.quit()
```

On Windows, `SIGTERM` is not supported. Use `child.kill()` which calls `taskkill`. Consider `tree-kill` npm package if the sidecar spawns sub-processes (uvicorn workers).

### 8C. Crash Recovery

Listen on `child.on('exit', (code, signal))`:
- If `code !== 0` and app is not quitting: attempt one automatic restart
- Show notification to user: "Backend restarted after unexpected exit"
- If second crash within 30s: show error dialog, do not retry

---

## 9. Justfile / Makefile Targets

Add these recipes to the existing `justfile`:

```just
# Build PyInstaller sidecar binary
build-sidecar:
    cd backend && uv run pyinstaller medha.spec

# Compile Electron main process TypeScript
build-electron:
    cd electron && npx tsc -p tsconfig.json

# Build everything for desktop packaging
build-desktop: build-sidecar build-frontend build-electron
    npx electron-builder

# Run Electron in dev mode (backend + frontend must be running separately)
electron-dev:
    ELECTRON_DEV=1 npx electron electron/dist/main.js

# Run full desktop dev stack
desktop-dev:
    #!/usr/bin/env bash
    set -euo pipefail
    lsof -ti:18900,5173 | xargs kill -9 2>/dev/null || true
    trap 'kill 0' EXIT
    (cd backend && uv run uvicorn app.main:app --port 18900 --reload) &
    while ! nc -z localhost 18900 2>/dev/null; do sleep 0.1; done
    (cd frontend && NODE_ENV=development npm run dev) &
    while ! nc -z localhost 5173 2>/dev/null; do sleep 0.1; done
    ELECTRON_DEV=1 npx electron electron/dist/main.js &
    wait

# Package macOS DMG
pack-mac: build-desktop
    npx electron-builder --mac

# Clean desktop build artifacts
clean-desktop:
    rm -rf backend/dist backend/build
    rm -rf electron/dist
    rm -rf release
```

---

## 10. Phase Breakdown

### Phase 1: Scaffold and Dev Shell (estimated: 2-3 hours)

Goal: Electron window loads the Vite dev server, no sidecar management yet.

Tasks:
1. Create `electron/` directory with `main.ts`, `preload.ts`, `tsconfig.json`
2. Create root `package.json` with electron devDependency
3. Implement `main.ts`: BrowserWindow that loads `http://localhost:5173` when `ELECTRON_DEV=1`
4. Implement `preload.ts` with `contextBridge` stub (just `getPlatform()`)
5. Add `electron-dev` justfile recipe
6. Verify: run `just dev` in one terminal, `just electron-dev` in another — app appears in Electron window with full functionality via Vite proxy

No frontend changes needed in this phase — everything works through Vite's proxy.

### Phase 2: Sidecar Lifecycle (estimated: 3-4 hours)

Goal: Electron spawns and manages the Python backend automatically.

Tasks:
1. Implement `port.ts` (free port finder)
2. Implement `sidecar.ts` (spawn, health check, shutdown)
3. Wire into `main.ts`: startup sequence, shutdown hooks, crash recovery
4. Add `MEDHA_PORT` env var support to backend `main.py` (`__main__` guard)
5. Implement `ipc-handlers.ts` with `get-port` channel
6. Verify: start Electron without manually running the backend — backend auto-starts, health check passes, window shows

### Phase 3: IPC and Frontend Integration (estimated: 2-3 hours)

Goal: Frontend works in both Electron and web mode.

Tasks:
1. Add `getApiBase()` to `frontend/src/lib/api.ts` — prepend `http://localhost:{port}` when in Electron
2. Update `EventSource` URL in `api.ts` to use base URL
3. Add `electron.d.ts` type declarations
4. Implement `pick-directory` IPC handler
5. Update workspace folder picker component to use `window.electronAPI.pickDirectory()` when available
6. Implement `backend-ready` / `backend-error` event forwarding to renderer
7. Add a loading/splash state in the renderer while waiting for `backend-ready`
8. Verify: full app works in Electron with auto-spawned backend, folder picker opens native dialog

### Phase 4: PyInstaller + Packaging (estimated: 3-4 hours)

Goal: Produce a distributable macOS .dmg.

Tasks:
1. Create `backend/medha.spec` PyInstaller spec file
2. Test PyInstaller binary runs standalone: `./backend/dist/medha-backend` starts uvicorn
3. Create `electron-builder.yml` with extraResources config
4. Create `build/entitlements.mac.plist`
5. Update sidecar binary resolution for packaged mode (`process.resourcesPath`)
6. Add `build-desktop` and `pack-mac` justfile recipes
7. Build and test: DMG installs, app launches, backend starts from bundled binary
8. Verify: folder picker, query execution, chat — all work in packaged app

### Phase 5: Polish and Hardening (estimated: 2-3 hours)

Goal: Production-ready desktop experience.

Tasks:
1. App icon (convert existing `docs/brand/logo.png` to `.icns` for macOS)
2. Proper `about` panel with version info
3. macOS menu bar (File, Edit, View, Window, Help — standard Electron menu)
4. Backend log viewer: menu item to open `backend.log` in system editor
5. Auto-update infrastructure (electron-updater) — stub only, no update server yet
6. Handle macOS `activate` event (re-create window if all windows closed)
7. CORS: backend may need to allow `file://` origin or `http://localhost:{port}` — test and fix
8. Code signing discussion / documentation (required for macOS distribution outside App Store)

---

## 11. Open Questions

1. **PyInstaller vs. Nuitka:** PyInstaller is the default choice but Nuitka produces faster, smaller binaries. Worth evaluating if PyInstaller binary size or startup time is unacceptable.

2. **Single-binary vs. directory mode:** PyInstaller `--onefile` extracts to a temp dir on each launch (slow). `--onedir` is faster but means bundling a folder instead of a single file. Recommend `--onedir` for the sidecar since electron-builder can copy a directory to extraResources just as easily.

3. **CORS in Electron:** When loading from `file://`, the frontend makes cross-origin requests to `http://localhost:{port}`. The backend's CORS middleware needs to allow this. Currently not an issue in web mode because Vite proxies. Need to add `file://` and `http://localhost:*` to allowed origins.

4. **Windows support:** `SIGTERM` does not exist on Windows. The sidecar shutdown needs a Windows-specific path (e.g., `taskkill /pid {pid} /t /f`). Consider the `tree-kill` npm package. Defer to Phase 5+.

5. **Auto-update:** electron-updater supports GitHub Releases as an update source. This requires code signing on macOS. Defer until the app is stable enough for public releases.

6. **Universal binary on macOS:** PyInstaller does not natively produce universal (x86_64 + arm64) binaries. Options: build two separate binaries and use `lipo` to merge, or ship architecture-specific builds. electron-builder supports per-arch extraResources.

---

## 12. Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| PyInstaller binary misses hidden imports | Maintain a tested list of `hiddenimports` in medha.spec. CI step that builds and smoke-tests the binary. |
| Backend takes >15s to start (cold PyInstaller extract) | Use `--onedir` mode. Show a progress indicator in the Electron splash screen. |
| Port conflict (another process on 18900-18999) | Port finder tries all 100 ports. If all taken, show error dialog with instructions. |
| Backend crashes silently | Pipe stderr to log file. Single auto-restart. User-visible error on repeated crash. |
| CORS blocks requests in Electron | Add `http://localhost:*` and `app://*` to FastAPI CORS allowed_origins. Test during Phase 3. |
| macOS Gatekeeper blocks unsigned app | Document code signing process. For dev/testing, instruct users to right-click > Open. |
