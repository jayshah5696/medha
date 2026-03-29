/**
 * IPC handler registrations — all renderer ↔ main communication.
 */

import { ipcMain, dialog, app } from "electron";
import { getBackendLogPath } from "./sidecar";

let backendPort: number = 18900;

export function setPort(port: number): void {
  backendPort = port;
}

export function registerIpcHandlers(): void {
  ipcMain.handle("pick-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("get-port", () => {
    return backendPort;
  });

  ipcMain.handle("get-platform", () => {
    return process.platform;
  });

  ipcMain.handle("show-save-dialog", async (_event, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(options);
    if (result.canceled) return null;
    return result.filePath;
  });

  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("get-log-path", () => {
    return getBackendLogPath();
  });
}
