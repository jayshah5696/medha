/**
 * Python backend sidecar lifecycle: spawn, health check, shutdown.
 */

import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { app } from "electron";

let backendProcess: ChildProcess | null = null;
let logStream: fs.WriteStream | null = null;

function getLogPath(): string {
  const logDir = path.join(app.getPath("logs"));
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, "backend.log");
}

export function getBackendLogPath(): string {
  return getLogPath();
}

function getSidecarPath(): string {
  // Packaged app: sidecar is in extraResources
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "sidecar", "medha-backend");
  }
  // Dev mode with built binary
  return path.join(__dirname, "..", "backend", "dist", "medha-backend");
}

export function spawnBackend(port: number, isDev: boolean): ChildProcess {
  const logPath = getLogPath();
  logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n--- Backend starting at ${new Date().toISOString()} on port ${port} ---\n`);

  const env = {
    ...process.env,
    MEDHA_PORT: String(port),
  };

  let child: ChildProcess;

  if (isDev) {
    // Dev mode: run uvicorn directly via uv
    const backendDir = path.join(__dirname, "..", "backend");
    child = spawn(
      "uv",
      ["run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port), "--reload"],
      { cwd: backendDir, env, stdio: ["ignore", "pipe", "pipe"] }
    );
  } else {
    // Production: run PyInstaller binary
    const binaryPath = getSidecarPath();
    child = spawn(binaryPath, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  }

  child.stdout?.on("data", (data: Buffer) => {
    logStream?.write(data);
  });

  child.stderr?.on("data", (data: Buffer) => {
    logStream?.write(data);
  });

  child.on("error", (err) => {
    logStream?.write(`Backend process error: ${err.message}\n`);
  });

  backendProcess = child;
  return child;
}

export function waitForHealth(
  port: number,
  timeoutMs: number = 15000
): Promise<void> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    function poll() {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Backend health check timed out after ${timeoutMs}ms`));
        return;
      }

      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (data.ok) {
              resolve();
              return;
            }
          } catch {
            // not ready yet
          }
          setTimeout(poll, 200);
        });
      });

      req.on("error", () => {
        setTimeout(poll, 200);
      });

      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(poll, 200);
      });
    }

    poll();
  });
}

export async function shutdownBackend(): Promise<void> {
  if (!backendProcess || backendProcess.killed) return;

  return new Promise<void>((resolve) => {
    const child = backendProcess!;

    const forceKillTimer = setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 3000);

    child.once("exit", () => {
      clearTimeout(forceKillTimer);
      resolve();
    });

    child.kill("SIGTERM");
  }).then(() => {
    logStream?.write(`--- Backend stopped at ${new Date().toISOString()} ---\n`);
    logStream?.end();
    logStream = null;
    backendProcess = null;
  });
}

export function getBackendProcess(): ChildProcess | null {
  return backendProcess;
}
