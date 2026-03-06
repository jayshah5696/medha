import { useCallback, useState } from "react";
import type { EditorView } from "@codemirror/view";
import FileExplorer from "./components/FileExplorer";
import SqlEditor from "./components/SqlEditor";
import ResultGrid from "./components/ResultGrid";
import ChatSidebar from "./components/ChatSidebar";
import DiffOverlay from "./components/DiffOverlay";
import { useStore } from "./store";
import { runQuery } from "./lib/api";
import "./index.css";

function App() {
  const {
    queryResult,
    isQuerying,
    lastError,
    setQueryResult,
    setIsQuerying,
    setLastError,
  } = useStore();

  const [diffState, setDiffState] = useState<{
    selectedSql: string;
    editorView: EditorView;
  } | null>(null);

  const handleExecute = useCallback(
    async (query: string) => {
      setIsQuerying(true);
      setLastError(null);
      try {
        const qid = crypto.randomUUID();
        const result = await runQuery(query, qid);
        setQueryResult(result);
      } catch (e) {
        setLastError(e instanceof Error ? e.message : String(e));
        setQueryResult(null);
      } finally {
        setIsQuerying(false);
      }
    },
    [setIsQuerying, setLastError, setQueryResult]
  );

  const handleCmdK = useCallback(
    (selectedText: string, view: EditorView) => {
      setDiffState({ selectedSql: selectedText, editorView: view });
    },
    []
  );

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      <FileExplorer />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "8px 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-secondary)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 16 }}>Medha</span>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Local SQL IDE for flat files
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--text-secondary)",
            }}
          >
            Cmd+Enter: Run | Cmd+K: Edit | Cmd+L: Chat
          </span>
        </div>

        {/* Error banner */}
        {lastError && (
          <div
            style={{
              padding: "8px 16px",
              background: "rgba(243, 139, 168, 0.15)",
              color: "var(--error)",
              fontSize: 13,
              borderBottom: "1px solid var(--error)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{lastError}</span>
            <button
              onClick={() => setLastError(null)}
              style={{
                background: "none",
                border: "none",
                color: "var(--error)",
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              x
            </button>
          </div>
        )}

        {/* Editor */}
        <SqlEditor onExecute={handleExecute} onCmdK={handleCmdK} />

        {/* Results */}
        <ResultGrid result={queryResult} isQuerying={isQuerying} />
      </div>

      <ChatSidebar />

      {/* Cmd+K Diff Overlay */}
      {diffState && (
        <DiffOverlay
          selectedSql={diffState.selectedSql}
          editorView={diffState.editorView}
          onClose={() => setDiffState(null)}
        />
      )}
    </div>
  );
}

export default App;
