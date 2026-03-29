/**
 * Electron main process — creates window, manages backend sidecar lifecycle,
 * and serves as a local proxy so the frontend needs zero URL changes.
 */

import { app, BrowserWindow, dialog, shell } from "electron";
import * as path from "path";
import * as http from "http";
import * as url from "url";
import * as fs from "fs";
import { findFreePort } from "./port";
import { spawnBackend, waitForHealth, shutdownBackend, getBackendProcess } from "./sidecar";
import { registerIpcHandlers, setPort } from "./ipc-handlers";

const isDev = process.env.ELECTRON_DEV === "1";
let mainWindow: BrowserWindow | null = null;
let backendPort: number = 18900;
let proxyServer: http.Server | null = null;
let isQuitting = false;
let crashCount = 0;
let lastCrashTime = 0;

function createWindow(port: number): BrowserWindow {
  const preloadPath = path.join(__dirname, "preload.js");

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0a0a0b",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for preload to use require
    },
  });

  // Show when ready to prevent white flash
  win.once("ready-to-show", () => {
    win.show();
  });

  if (isDev) {
    // Dev mode: load Vite dev server (which proxies /api to backend)
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Production: load static build via local proxy that forwards /api to backend
    const proxyPort = port + 100; // proxy on a different port
    startProxy(proxyPort, port);
    win.loadURL(`http://localhost:${proxyPort}`);
  }

  win.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    shell.openExternal(linkUrl);
    return { action: "deny" };
  });

  return win;
}

/**
 * Local proxy server: serves frontend static files and proxies /api to the backend.
 * This means the frontend code uses relative URLs (e.g., /api/workspace/files)
 * with zero changes — same as in Vite dev mode.
 */
function startProxy(proxyPort: number, apiPort: number): void {
  const frontendDist = app.isPackaged
    ? path.join(process.resourcesPath, "frontend-dist")
    : path.join(__dirname, "..", "frontend", "dist");

  proxyServer = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url || "/");
    const pathname = parsedUrl.pathname || "/";

    // Proxy /api and /health to the Python backend
    if (pathname.startsWith("/api/") || pathname === "/health") {
      const proxyReq = http.request(
        {
          hostname: "127.0.0.1",
          port: apiPort,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );

      proxyReq.on("error", (err) => {
        res.writeHead(502);
        res.end(`Backend unavailable: ${err.message}`);
      });

      req.pipe(proxyReq);
      return;
    }

    // Serve static files from frontend/dist
    let filePath = path.join(frontendDist, pathname === "/" ? "index.html" : pathname);

    // SPA fallback: if file doesn't exist, serve index.html
    if (!fs.existsSync(filePath)) {
      filePath = path.join(frontendDist, "index.html");
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".map": "application/json",
    };

    const contentType = mimeTypes[ext] || "application/octet-stream";

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  proxyServer.listen(proxyPort, "127.0.0.1");
}

function handleBackendCrash(code: number | null, signal: string | null): void {
  if (isQuitting) return;

  const now = Date.now();
  if (now - lastCrashTime < 30000) {
    crashCount++;
  } else {
    crashCount = 1;
  }
  lastCrashTime = now;

  if (crashCount >= 2) {
    dialog.showErrorBox(
      "Backend Error",
      `The backend has crashed repeatedly (exit code: ${code}, signal: ${signal}).\n\nCheck the log file for details.`
    );
    return;
  }

  // Single auto-restart attempt
  dialog.showMessageBox({
    type: "warning",
    title: "Backend Restarted",
    message: "The backend process exited unexpectedly and has been restarted.",
    buttons: ["OK"],
  });

  const child = spawnBackend(backendPort, isDev);
  child.on("exit", handleBackendCrash);
  waitForHealth(backendPort, 15000).then(() => {
    mainWindow?.webContents.send("backend-ready", { port: backendPort });
  }).catch(() => {
    dialog.showErrorBox("Backend Error", "Backend failed to restart. Please relaunch the app.");
  });
}

async function bootstrap(): Promise<void> {
  registerIpcHandlers();

  if (isDev) {
    // Dev mode: backend is managed externally, just create window
    backendPort = 18900;
    setPort(backendPort);
    mainWindow = createWindow(backendPort);
    return;
  }

  // Production: find port, spawn backend, wait for health
  try {
    backendPort = await findFreePort(18900, 18999);
    setPort(backendPort);

    const child = spawnBackend(backendPort, isDev);

    child.on("exit", handleBackendCrash);

    await waitForHealth(backendPort, 15000);

    mainWindow = createWindow(backendPort);
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send("backend-ready", { port: backendPort });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(
      "Failed to Start",
      `Could not start the backend:\n\n${message}\n\nPlease check that no other instance is running.`
    );
    app.quit();
  }
}

// --- App lifecycle ---

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  // On macOS, apps stay open until Cmd+Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // macOS: re-create window when dock icon clicked and no windows open
  if (BrowserWindow.getAllWindows().length === 0 && backendPort) {
    mainWindow = createWindow(backendPort);
  }
});

app.on("before-quit", async () => {
  isQuitting = true;
  proxyServer?.close();
  await shutdownBackend();
});
