import { useCallback, useState, useEffect } from "react";
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

const BANNER_DISMISSED_KEY = "medha_key_banner_dismissed";
const DEFAULT_LM_STUDIO_URL = "http://localhost:1234/v1";

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
  const [showKeyBanner, setShowKeyBanner] = useState(false);

  // First-run check: if no LLM is configured, show onboarding banner
  useEffect(() => {
    const dismissed = localStorage.getItem(BANNER_DISMISSED_KEY);
    if (dismissed === "true") return;

    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const hasOpenAI = data.openai_api_key && data.openai_api_key.length > 0;
        const hasOpenRouter = data.openrouter_api_key && data.openrouter_api_key.length > 0;
        const customLmStudio = data.lm_studio_url && data.lm_studio_url !== DEFAULT_LM_STUDIO_URL;
        if (!hasOpenAI && !hasOpenRouter && !customLmStudio) {
          setShowKeyBanner(true);
        }
      })
      .catch(() => {
        // backend not ready yet, skip
      });
  }, []);

  const dismissBanner = () => {
    setShowKeyBanner(false);
    localStorage.setItem(BANNER_DISMISSED_KEY, "true");
  };

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

      {/* Onboarding banner: no API key configured */}
      {showKeyBanner && (
        <div
          style={{
            padding: "6px 12px",
            background: "rgba(255, 180, 0, 0.1)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            fontSize: 11,
            fontFamily: "var(--font-ui)",
            color: "var(--text-secondary)",
          }}
        >
          <span>
            No LLM configured. Open Settings to add an API key before using ⌘K or ⌘L.
          </span>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => {
                setShowSettings(true);
                dismissBanner();
              }}
              style={{
                padding: "3px 10px",
                fontSize: 10,
                fontFamily: "var(--font-ui)",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                background: "var(--accent)",
                color: "var(--bg-primary)",
                border: "none",
                cursor: "pointer",
              }}
            >
              Open Settings
            </button>
            <button
              onClick={dismissBanner}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-dimmed)",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                padding: "0 4px",
              }}
            >
              x
            </button>
          </div>
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
          <SqlEditor
            onExecute={handleExecute}
            onCmdK={handleCmdK}
            queryError={lastError}
            onDismissError={() => setLastError(null)}
          />
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
