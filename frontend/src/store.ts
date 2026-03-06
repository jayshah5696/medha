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

  // Chat thread persistence
  currentThreadId: string | null;
  setThreadId: (slug: string | null) => void;

  chatHistory: ChatThreadSummary[];
  setChatHistory: (threads: ChatThreadSummary[]) => void;

  isChatOpen: boolean;
  toggleChatSidebar: () => void;
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

  queryResult: null,
  setQueryResult: (result) => set({ queryResult: result }),

  isQuerying: false,
  setIsQuerying: (v) => set({ isQuerying: v }),

  lastError: null,
  setLastError: (err) => set({ lastError: err }),

  editorContent: "SELECT 1;",
  setEditorContent: (sql) => set({ editorContent: sql }),

  loadHistoryEntry: (sql) => set({ editorContent: sql }),

  currentThreadId: null,
  setThreadId: (slug) => set({ currentThreadId: slug }),

  chatHistory: [],
  setChatHistory: (threads) => set({ chatHistory: threads }),

  isChatOpen: true,
  toggleChatSidebar: () => set((state) => ({ isChatOpen: !state.isChatOpen })),
}));
