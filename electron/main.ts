/**
 * Electron main process — creates window, manages backend sidecar lifecycle,
 * and serves as a local proxy so the frontend needs zero URL changes.
 */

import { app, BrowserWindow, dialog, session, shell } from "electron";
import * as path from "path";
import * as http from "http";
import * as url from "url";
import * as fs from "fs";
import { findFreePort } from "./port";
import { spawnBackend, waitForHealth, shutdownBackend } from "./sidecar";
import { registerIpcHandlers, setPort } from "./ipc-handlers";

const isDev = process.env.ELECTRON_DEV === "1";
let mainWindow: BrowserWindow | null = null;
let backendPort: number = 18900;
let proxyServer: http.Server | null = null;
let isQuitting = false;
let crashCount = 0;
let lastCrashTime = 0;

/**
 * Start the local proxy server and return a promise that resolves
 * once the server is actually listening.
 */
function startProxy(proxyPort: number, apiPort: number): Promise<void> {
  const frontendDist = app.isPackaged
    ? path.join(process.resourcesPath, "frontend-dist")
    : path.join(__dirname, "..", "frontend", "dist");

  return new Promise<void>((resolve, reject) => {
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

            // Flush headers immediately for SSE so chunks stream without delay
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              res.flushHeaders();
            }

            proxyRes.pipe(res);
          }
        );

        // Disable timeout for SSE and other long-lived connections
        proxyReq.setTimeout(0);

        proxyReq.on("error", (err) => {
          if (!res.headersSent) {
            res.writeHead(502);
            res.end(`Backend unavailable: ${err.message}`);
          }
        });

        // Clean up upstream connection when client disconnects (prevents SSE leaks)
        req.on("close", () => {
          proxyReq.destroy();
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

      // Stream files instead of blocking with readFileSync
      const stream = fs.createReadStream(filePath);
      stream.on("open", () => {
        res.writeHead(200, { "Content-Type": contentType });
        stream.pipe(res);
      });
      stream.on("error", () => {
        res.writeHead(404);
        res.end("Not found");
      });
    });

    proxyServer.on("error", reject);
    proxyServer.listen(proxyPort, "127.0.0.1", () => resolve());
  });
}

function createWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, "preload.js");

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 16, y: 16 } : undefined,
    backgroundColor: "#0a0a0b",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Show when ready to prevent white flash
  win.once("ready-to-show", () => {
    win.show();
  });

  // Block navigation to unexpected origins
  win.webContents.on("will-navigate", (event, navigationUrl) => {
    const parsed = new URL(navigationUrl);
    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      event.preventDefault();
    }
  });

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    shell.openExternal(linkUrl);
    return { action: "deny" };
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

function handleBackendCrash(code: number | null, signal: string | null): void {
  if (isQuitting || isDev) return;

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
  const child = spawnBackend(backendPort, isDev);
  child.on("exit", handleBackendCrash);
  waitForHealth(backendPort, 15000)
    .then(() => {
      mainWindow?.webContents.send("backend-ready", { port: backendPort });
      dialog.showMessageBox({
        type: "info",
        title: "Backend Restarted",
        message: "The backend process exited unexpectedly and has been restarted.",
        buttons: ["OK"],
      });
    })
    .catch(() => {
      dialog.showErrorBox(
        "Backend Error",
        "Backend failed to restart. Please relaunch the app."
      );
    });
}

function setupCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "font-src 'self'; " +
            "img-src 'self' data:; " +
            "connect-src 'self' http://localhost:* http://127.0.0.1:*",
        ],
      },
    });
  });
}

async function bootstrap(): Promise<void> {
  registerIpcHandlers();
  setupCSP();

  if (isDev) {
    // Dev mode: backend is managed externally, just create window
    backendPort = 18900;
    setPort(backendPort);
    mainWindow = createWindow();
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  // Production: find port, spawn backend, wait for health
  try {
    backendPort = await findFreePort(18900, 18999);
    setPort(backendPort);

    const child = spawnBackend(backendPort, isDev);
    child.on("exit", handleBackendCrash);

    await waitForHealth(backendPort, 15000);

    const proxyPort = backendPort + 100;
    await startProxy(proxyPort, backendPort);

    mainWindow = createWindow();
    mainWindow.loadURL(`http://localhost:${proxyPort}`);
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
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // Verify backend is alive before recreating window
    try {
      await waitForHealth(backendPort, 3000);
      mainWindow = createWindow();
      const proxyPort = backendPort + 100;
      if (isDev) {
        mainWindow.loadURL("http://localhost:5173");
      } else {
        mainWindow.loadURL(`http://localhost:${proxyPort}`);
      }
    } catch {
      dialog.showErrorBox(
        "Backend Unavailable",
        "The backend is not running. Please relaunch the app."
      );
    }
  }
});

app.on("before-quit", (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  proxyServer?.close();
  shutdownBackend().finally(() => {
    app.exit(0);
  });
});
