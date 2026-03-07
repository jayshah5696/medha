import { create } from "zustand";
import type { FileInfo, QueryResult, ChatThreadSummary } from "./lib/api";

interface MedhaStore {
  workspacePath: string;
  setWorkspacePath: (path: string) => void;

  files: FileInfo[];
  setFiles: (files: FileInfo[]) => void;

  activeFiles: string[];
  toggleActiveFile: (name: string) => void;
  addActiveFile: (name: string) => void;
  removeActiveFile: (name: string) => void;
  clearActiveFiles: () => void;

  queryResult: QueryResult | null;
  setQueryResult: (result: QueryResult | null) => void;

  isQuerying: boolean;
  setIsQuerying: (v: boolean) => void;

  lastError: string | null;
  setLastError: (err: string | null) => void;

  editorContent: string;
  setEditorContent: (sql: string) => void;

  // History: load SQL into editor
  loadHistoryEntry: (sql: string) => void;

  // BUG-4: history version counter — incremented after each query
  // so sidebar auto-refreshes history list
  historyVersion: number;
  bumpHistoryVersion: () => void;

  // Chat thread persistence
  currentThreadId: string | null;
  setThreadId: (slug: string | null) => void;

  chatHistory: ChatThreadSummary[];
  setChatHistory: (threads: ChatThreadSummary[]) => void;

  isChatOpen: boolean;
  toggleChatSidebar: () => void;

  // FEAT-1: resizable result pane height
  resultPaneHeight: number;
  setResultPaneHeight: (h: number) => void;

  // Agent query result: stored separately so it doesn't overwrite
  // the user's editor content during agent streaming
  agentLastQuery: string | null;
  setAgentLastQuery: (sql: string | null) => void;

  // FEAT-8-3: Toast notifications
  toasts: Toast[];
  addToast: (message: string) => void;
  removeToast: (id: string) => void;
}

export interface Toast {
  id: string;
  message: string;
  createdAt: number;
}

export const useStore = create<MedhaStore>((set) => ({
  workspacePath: "",
  setWorkspacePath: (path) => set({ workspacePath: path }),

  files: [],
  setFiles: (files) => set({ files }),

  activeFiles: [],
  toggleActiveFile: (name) =>
    set((state) => {
      const idx = state.activeFiles.indexOf(name);
      if (idx >= 0) {
        return { activeFiles: state.activeFiles.filter((f) => f !== name) };
      }
      return { activeFiles: [...state.activeFiles, name] };
    }),
  addActiveFile: (name) =>
    set((state) => {
      if (state.activeFiles.includes(name)) return state;
      return { activeFiles: [...state.activeFiles, name] };
    }),
  removeActiveFile: (name) =>
    set((state) => ({
      activeFiles: state.activeFiles.filter((f) => f !== name),
    })),
  clearActiveFiles: () => set({ activeFiles: [] }),

  queryResult: null,
  setQueryResult: (result) => set({ queryResult: result }),

  isQuerying: false,
  setIsQuerying: (v) => set({ isQuerying: v }),

  lastError: null,
  setLastError: (err) => set({ lastError: err }),

  editorContent: "SELECT 1;",
  setEditorContent: (sql) => set({ editorContent: sql }),

  loadHistoryEntry: (sql) => set({ editorContent: sql }),

  historyVersion: 0,
  bumpHistoryVersion: () =>
    set((state) => ({ historyVersion: state.historyVersion + 1 })),

  currentThreadId: null,
  setThreadId: (slug) => set({ currentThreadId: slug }),

  chatHistory: [],
  setChatHistory: (threads) => set({ chatHistory: threads }),

  isChatOpen: true,
  toggleChatSidebar: () => set((state) => ({ isChatOpen: !state.isChatOpen })),

  resultPaneHeight: 250,
  setResultPaneHeight: (h) => set({ resultPaneHeight: h }),

  agentLastQuery: null,
  setAgentLastQuery: (sql) => set({ agentLastQuery: sql }),

  toasts: [],
  addToast: (message) =>
    set((state) => {
      const id = crypto.randomUUID();
      const toast: Toast = { id, message, createdAt: Date.now() };
      // Auto-remove after 5 seconds
      setTimeout(() => {
        useStore.getState().removeToast(id);
      }, 5000);
      return { toasts: [...state.toasts, toast] };
    }),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
