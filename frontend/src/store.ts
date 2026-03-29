import { create } from "zustand";
import type { FileInfo, QueryResult, ChatThreadSummary } from "./lib/api";

export interface SqlTab {
  id: string;
  filename: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  isNew: boolean;
}

function createUntitledTab(n: number): SqlTab {
  return {
    id: crypto.randomUUID(),
    filename: `untitled-${n}.sql`,
    content: "SELECT 1;",
    savedContent: "",
    isDirty: true,
    isNew: true,
  };
}

function nextUntitledNumber(tabs: SqlTab[]): number {
  const nums = tabs
    .map((t) => {
      const m = t.filename.match(/^untitled-(\d+)\.sql$/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter((n) => n > 0);
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

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
  appendQueryRows: (result: QueryResult) => void;

  isQuerying: boolean;
  setIsQuerying: (v: boolean) => void;

  isLoadingMore: boolean;
  setIsLoadingMore: (v: boolean) => void;

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

  // Multi-tab SQL editor
  tabs: SqlTab[];
  activeTabId: string;
  openTab: (filename?: string, content?: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabContent: (id: string, content: string) => void;
  markTabSaved: (id: string, filename?: string) => void;

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

const initialTab = createUntitledTab(1);

function safeGetItem(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore — localStorage may not be available in test environments
  }
}

export const useStore = create<MedhaStore>((set) => ({
  workspacePath: safeGetItem("medha_workspace"),
  setWorkspacePath: (path) => {
    safeSetItem("medha_workspace", path);
    set({ workspacePath: path });
  },

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
  appendQueryRows: (result) =>
    set((state) => {
      if (!state.queryResult) return state;
      return {
        queryResult: {
          ...state.queryResult,
          rows: [...state.queryResult.rows, ...result.rows],
          row_count: state.queryResult.rows.length + result.rows.length,
          has_more: result.has_more,
          offset: result.offset,
        },
      };
    }),

  isQuerying: false,
  setIsQuerying: (v) => set({ isQuerying: v }),

  isLoadingMore: false,
  setIsLoadingMore: (v) => set({ isLoadingMore: v }),

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

  // Multi-tab SQL editor
  tabs: [initialTab],
  activeTabId: initialTab.id,

  openTab: (filename?: string, content?: string) =>
    set((state) => {
      // If opening a saved file that's already in a tab, switch to it
      if (filename) {
        const existing = state.tabs.find((t) => t.filename === filename);
        if (existing) {
          return { activeTabId: existing.id, editorContent: existing.content };
        }
      }
      const isNew = !filename;
      const n = nextUntitledNumber(state.tabs);
      const tab: SqlTab = {
        id: crypto.randomUUID(),
        filename: filename || `untitled-${n}.sql`,
        content: content ?? "SELECT 1;",
        savedContent: content ?? "",
        isDirty: isNew,
        isNew,
      };
      return {
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        editorContent: tab.content,
      };
    }),

  closeTab: (id) =>
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return state;
      const remaining = state.tabs.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const fresh = createUntitledTab(1);
        return {
          tabs: [fresh],
          activeTabId: fresh.id,
          editorContent: fresh.content,
        };
      }
      if (state.activeTabId === id) {
        const newActive = remaining[Math.min(idx, remaining.length - 1)];
        return {
          tabs: remaining,
          activeTabId: newActive.id,
          editorContent: newActive.content,
        };
      }
      return { tabs: remaining };
    }),

  setActiveTab: (id) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;
      // Save current tab's content from editorContent before switching
      const updatedTabs = state.tabs.map((t) =>
        t.id === state.activeTabId
          ? { ...t, content: state.editorContent, isDirty: state.editorContent !== t.savedContent }
          : t
      );
      return {
        tabs: updatedTabs,
        activeTabId: id,
        editorContent: tab.content,
      };
    }),

  updateTabContent: (id, content) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? { ...t, content, isDirty: content !== t.savedContent }
          : t
      ),
    })),

  markTabSaved: (id, filename?) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              savedContent: t.content,
              isDirty: false,
              isNew: false,
              ...(filename ? { filename } : {}),
            }
          : t
      ),
    })),

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
