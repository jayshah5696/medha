/** Type declarations for the Electron preload API. */

interface ElectronAPI {
  pickDirectory(): Promise<string | null>;
  getPort(): Promise<number>;
  getPlatform(): Promise<string>;
  showSaveDialog(options: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;
  getAppVersion(): Promise<string>;
  getLogPath(): Promise<string>;
  onBackendReady(callback: (port: number) => void): void;
  onBackendError(callback: (error: string) => void): void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
