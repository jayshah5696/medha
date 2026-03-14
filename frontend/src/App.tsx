import { useCallback, useState, useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { Sun, Moon, Settings } from "lucide-react";
import FileExplorer from "./components/FileExplorer";
import SqlEditor from "./components/SqlEditor";
import ResultGrid from "./components/ResultGrid";
import ChatSidebar from "./components/ChatSidebar";
import DiffOverlay from "./components/DiffOverlay";
import SettingsModal from "./components/SettingsModal";
import { useStore } from "./store";
import { runQuery, getFiles, openEventStream } from "./lib/api";
import "./index.css";

const BANNER_DISMISSED_KEY = "medha_key_banner_dismissed";
const DEFAULT_LM_STUDIO_URL = "http://localhost:1234/v1";
const THEME_KEY = "medha_theme";

function App() {
  const {
    workspacePath,
    queryResult,
    isQuerying,
    lastError,
    isChatOpen,
    setQueryResult,
    appendQueryRows,
    setIsQuerying,
    setLastError,
    bumpHistoryVersion,
    resultPaneHeight,
    setResultPaneHeight,
    isLoadingMore,
    setIsLoadingMore,
    editorContent,
  } = useStore();

  const [diffState, setDiffState] = useState<{
    selectedSql: string;
    editorView: EditorView;
  } | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showKeyBanner, setShowKeyBanner] = useState(false);

  // Theme toggle
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem(THEME_KEY) as "dark" | "light") || "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () =>
    setTheme((t) => (t === "dark" ? "light" : "dark"));

  // Resizable sidebars
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(320);
  const dragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleDragStart = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = {
        side,
        startX: e.clientX,
        startWidth: side === "left" ? leftWidth : rightWidth,
      };

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = ev.clientX - dragRef.current.startX;
        const newWidth = Math.max(
          140,
          Math.min(
            600,
            dragRef.current.side === "left"
              ? dragRef.current.startWidth + delta
              : dragRef.current.startWidth - delta
          )
        );
        if (dragRef.current.side === "left") setLeftWidth(newWidth);
        else setRightWidth(newWidth);
      };

      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [leftWidth, rightWidth]
  );

  // FEAT-1: Vertical drag handle between editor and result pane
  const vDragRef = useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);

  const handleVDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      vDragRef.current = {
        startY: e.clientY,
        startHeight: resultPaneHeight,
      };

      const onMove = (ev: MouseEvent) => {
        if (!vDragRef.current) return;
        // Dragging up = increasing result pane height (delta is negative when moving up)
        const delta = vDragRef.current.startY - ev.clientY;
        const newHeight = Math.max(
          100,
          Math.min(
            window.innerHeight * 0.8,
            vDragRef.current.startHeight + delta
          )
        );
        setResultPaneHeight(newHeight);
      };

      const onUp = () => {
        vDragRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [resultPaneHeight, setResultPaneHeight]
  );

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

  // SSE: listen for file changes and refresh the file list
  const setFiles = useStore((s) => s.setFiles);
  const removeActiveFile = useStore((s) => s.removeActiveFile);
  const addToast = useStore((s) => s.addToast);
  const activeFilesRef = useRef(useStore.getState().activeFiles);
  useEffect(() => {
    return useStore.subscribe((s) => { activeFilesRef.current = s.activeFiles; });
  }, []);
  useEffect(() => {
    const es = openEventStream((event) => {
      // Always refresh file list
      getFiles().then(setFiles).catch(() => {});

      // Differentiated reactions based on change type
      if (event.change === "added") {
        addToast(`New file: ${event.path}`);
      } else if (event.change === "modified") {
        if (activeFilesRef.current.includes(event.path)) {
          addToast(`${event.path} was updated externally`);
        }
      } else if (event.change === "deleted") {
        removeActiveFile(event.path);
        addToast(`${event.path} was removed`);
      }
    });
    return () => es.close();
  }, [setFiles, removeActiveFile, addToast]);

  const dismissBanner = () => {
    setShowKeyBanner(false);
    localStorage.setItem(BANNER_DISMISSED_KEY, "true");
  };

  const PAGE_SIZE = 500;

  const handleExecute = useCallback(
    async (query: string) => {
      setIsQuerying(true);
      setLastError(null);
      try {
        const qid = crypto.randomUUID();
        const result = await runQuery(query, qid, "json", 0, PAGE_SIZE);
        setQueryResult(result);
        bumpHistoryVersion(); // BUG-4: trigger sidebar history refresh
      } catch (e) {
        setLastError(e instanceof Error ? e.message : String(e));
        setQueryResult(null);
      } finally {
        setIsQuerying(false);
      }
    },
    [setIsQuerying, setLastError, setQueryResult, bumpHistoryVersion]
  );

  const handleLoadMore = useCallback(async () => {
    if (!queryResult?.has_more || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const nextOffset = queryResult.rows.length;
      const qid = crypto.randomUUID();
      const result = await runQuery(editorContent, qid, "json", nextOffset, PAGE_SIZE);
      appendQueryRows(result);
    } catch (e) {
      console.error("Failed to load more rows:", e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [queryResult, isLoadingMore, editorContent, setIsLoadingMore, appendQueryRows]);

  const handleCmdK = useCallback(
    (selectedText: string, view: EditorView) => {
      setDiffState({ selectedSql: selectedText, editorView: view });
    },
    []
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100%" }}>
      {/* Header bar */}
      <div
        style={{
          height: "var(--header-height)",
          minHeight: "var(--header-height)",
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 12,
        }}
      >
        <svg
          viewBox="0 0 120 28"
          style={{ height: 20 }}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="medha"
        >
          {/* Bar chart icon */}
          <rect x="2" y="14" width="3.5" height="4" rx="0.5" fill="var(--accent)" />
          <rect x="7" y="8" width="3.5" height="10" rx="0.5" fill="var(--accent)" />
          <rect x="12" y="2" width="3.5" height="16" rx="0.5" fill="var(--accent)" />
          <rect x="17" y="6" width="3.5" height="12" rx="0.5" fill="var(--accent)" />
          {/* MEDHA text */}
          <text
            x="26"
            y="17.5"
            fill="var(--accent)"
            fontFamily="var(--font-ui)"
            fontSize="14"
            fontWeight="600"
            letterSpacing="0.15em"
          >
            MEDHA
          </text>
        </svg>
        <span
          style={{
            fontSize: 'var(--font-size-md)',
            color: "var(--text-dimmed)",
            fontFamily: "var(--font-ui)",
          }}
        >
          sql ide for flat files
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 'var(--font-size-lg)',
              padding: "2px 6px",
              lineHeight: 1,
            }}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            aria-label="Settings"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dimmed)",
              cursor: "pointer",
              fontSize: 'var(--font-size-lg)',
              fontFamily: "var(--font-mono)",
              padding: "2px 6px",
              lineHeight: 1,
            }}
          >
            <Settings size={14} />
          </button>
          <span
            style={{
              fontSize: 'var(--font-size-base)',
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
            padding: "8px 14px",
            background: "rgba(255, 180, 0, 0.1)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            fontSize: 'var(--font-size-base)',
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
                padding: "5px 14px",
                fontSize: 'var(--font-size-sm)',
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
              aria-label="Dismiss banner"
              style={{
                background: "none",
                border: "none",
                color: "var(--text-dimmed)",
                cursor: "pointer",
                fontSize: 'var(--font-size-sm)',
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
        <FileExplorer width={leftWidth} onFilePreview={handleExecute} />

        {/* Left resize handle */}
        <div
          onMouseDown={handleDragStart("left")}
          style={{
            width: 5,
            cursor: "col-resize",
            background: "var(--border)",
            position: "relative",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "0 -2px",
            }}
          />
        </div>

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
          {/* FEAT-1: Vertical resize handle */}
          <div
            onMouseDown={handleVDragStart}
            style={{
              height: 5,
              cursor: "row-resize",
              background: "var(--border)",
              position: "relative",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: "-2px 0",
              }}
            />
          </div>
          <ResultGrid
            result={queryResult}
            isQuerying={isQuerying}
            height={resultPaneHeight}
            onLoadMore={handleLoadMore}
            isLoadingMore={isLoadingMore}
          />
        </div>

        {/* Right resize handle + Right sidebar (toggled via Cmd+L) */}
        {isChatOpen && (
          <>
            <div
              onMouseDown={handleDragStart("right")}
              style={{
                width: 5,
                cursor: "col-resize",
                background: "var(--border)",
                position: "relative",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: "0 -2px",
                }}
              />
            </div>
            <ChatSidebar width={rightWidth} />
          </>
        )}
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
          fontSize: 'var(--font-size-sm)',
          color: "var(--text-dimmed)",
          fontFamily: "var(--font-ui)",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: workspacePath ? "var(--success)" : "var(--text-dimmed)",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span>{workspacePath || "no workspace"}</span>
        <span style={{ marginLeft: "auto", fontSize: 'var(--font-size-sm)' }}>medha v0.1</span>
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

      {/* Toast notifications (FEAT-8-3) */}
      <ToastContainer />
    </div>
  );
}

function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 40,
        right: 16,
        zIndex: 2000,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            padding: "6px 12px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-primary)",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            pointerEvents: "auto",
            cursor: "pointer",
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
          onClick={() => removeToast(toast.id)}
          title="Click to dismiss"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export default App;
