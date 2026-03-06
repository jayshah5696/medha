import { useCallback, useState } from "react";
import type { EditorView } from "@codemirror/view";
import FileExplorer from "./components/FileExplorer";
import SqlEditor from "./components/SqlEditor";
import ResultGrid from "./components/ResultGrid";
import ChatSidebar from "./components/ChatSidebar";
import DiffOverlay from "./components/DiffOverlay";
import SettingsModal from "./components/SettingsModal";
import { useStore } from "./store";
import { runQuery } from "./lib/api";
import "./index.css";

function App() {
  const {
    workspacePath,
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

  const [showSettings, setShowSettings] = useState(false);

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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw" }}>
      {/* Header bar */}
      <div
        style={{
          height: "var(--header-height)",
          minHeight: "var(--header-height)",
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 12,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 500,
            fontSize: 14,
            color: "var(--accent)",
            letterSpacing: "0.02em",
          }}
        >
          medha
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-dimmed)",
            fontFamily: "var(--font-ui)",
          }}
        >
          sql ide for flat files
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dimmed)",
              cursor: "pointer",
              fontSize: 16,
              fontFamily: "var(--font-mono)",
              padding: "2px 6px",
              lineHeight: 1,
            }}
          >
            &#9881;
          </button>
          <span
            style={{
              fontSize: 10,
              color: "var(--text-dimmed)",
              fontFamily: "var(--font-ui)",
            }}
          >
            duckdb
          </span>
        </div>
      </div>

      {/* Error banner */}
      {lastError && (
        <div
          style={{
            padding: "6px 12px",
            background: "var(--diff-remove-bg)",
            color: "var(--error)",
            fontSize: 12,
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "var(--font-mono)",
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
              fontSize: 14,
              padding: "0 4px",
              fontFamily: "var(--font-mono)",
            }}
          >
            x
          </button>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left sidebar */}
        <FileExplorer />

        {/* Divider */}
        <div style={{ width: 1, background: "var(--border)" }} />

        {/* Center panel */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          <SqlEditor onExecute={handleExecute} onCmdK={handleCmdK} />
          <ResultGrid result={queryResult} isQuerying={isQuerying} />
        </div>

        {/* Divider */}
        <div style={{ width: 1, background: "var(--border)" }} />

        {/* Right sidebar */}
        <ChatSidebar />
      </div>

      {/* Status bar */}
      <div
        style={{
          height: "var(--status-height)",
          minHeight: "var(--status-height)",
          background: "var(--bg-secondary)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 8,
          fontSize: 10,
          color: "var(--text-dimmed)",
          fontFamily: "var(--font-ui)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: workspacePath ? "var(--success)" : "var(--text-dimmed)",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span>{workspacePath || "no workspace"}</span>
        <span style={{ marginLeft: "auto" }}>medha v0.1</span>
      </div>

      {/* Cmd+K Diff Overlay */}
      {diffState && (
        <DiffOverlay
          selectedSql={diffState.selectedSql}
          editorView={diffState.editorView}
          onClose={() => setDiffState(null)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

export default App;
