/**
 * Preload script — exposes a minimal, typed API to the renderer via contextBridge.
 * No direct Node.js APIs are exposed. All communication via IPC channels.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  pickDirectory: (): Promise<string | null> => {
    return ipcRenderer.invoke("pick-directory");
  },

  getPort: (): Promise<number> => {
    return ipcRenderer.invoke("get-port");
  },

  getPlatform: (): Promise<string> => {
    return ipcRenderer.invoke("get-platform");
  },

  showSaveDialog: (options: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null> => {
    return ipcRenderer.invoke("show-save-dialog", options);
  },

  getAppVersion: (): Promise<string> => {
    return ipcRenderer.invoke("get-app-version");
  },

  getLogPath: (): Promise<string> => {
    return ipcRenderer.invoke("get-log-path");
  },

  // Use ipcRenderer.once to prevent listener accumulation on hot-reload
  onBackendReady: (callback: (port: number) => void): void => {
    ipcRenderer.once("backend-ready", (_event, data: { port: number }) => {
      callback(data.port);
    });
  },

  onBackendError: (callback: (error: string) => void): void => {
    ipcRenderer.once("backend-error", (_event, data: { error: string }) => {
      callback(data.error);
    });
  },
});
