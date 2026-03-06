import { useEffect, useRef, useCallback, useState } from "react";
import { EditorState, StateField, StateEffect, Prec } from "@codemirror/state";
import { EditorView, keymap, Decoration, type DecorationSet } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";
import { basicSetup } from "codemirror";
import { getHistory, getHistoryEntry } from "../lib/api";
import type { HistoryEntry } from "../lib/api";
import { useStore } from "../store";

// Error line decoration effect and field
const setErrorLine = StateEffect.define<number | null>();

const errorLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setErrorLine)) {
        if (effect.value === null) {
          return Decoration.none;
        }
        const lineNo = effect.value;
        if (lineNo >= 1 && lineNo <= tr.state.doc.lines) {
          const line = tr.state.doc.line(lineNo);
          const deco = Decoration.line({ class: "cm-error-line" });
          return Decoration.set([deco.range(line.from)]);
        }
        return Decoration.none;
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

interface SqlEditorProps {
  initialValue?: string;
  onExecute?: (query: string) => void;
  onCmdK?: (selectedText: string, view: EditorView) => void;
  onChange?: (value: string) => void;
  queryError?: string | null;
  onDismissError?: () => void;
}

export default function SqlEditor({
  initialValue = "SELECT 1;",
  onExecute,
  onCmdK,
  onChange,
  queryError,
  onDismissError,
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isQuerying = useStore((s) => s.isQuerying);

  const onExecuteRef = useRef(onExecute);
  onExecuteRef.current = onExecute;
  const onCmdKRef = useRef(onCmdK);
  onCmdKRef.current = onCmdK;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Keep a ref so the keymap closure sees the latest value
  const isQueryingRef = useRef(isQuerying);
  isQueryingRef.current = isQuerying;

  // History popover state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const getContent = useCallback(() => {
    return viewRef.current?.state.doc.toString() || "";
  }, []);

  const setContent = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  }, []);

  // Expose methods via ref
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__medhaEditor = {
      getContent,
      setContent,
      getView: () => viewRef.current,
    };
  }, [getContent, setContent]);

  // Handle error decoration
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (queryError) {
      // Try to parse line number from DuckDB error
      const lineMatch = queryError.match(/[Ll][Ii][Nn][Ee]\s+(\d+)/);
      if (lineMatch) {
        const lineNo = parseInt(lineMatch[1], 10);
        view.dispatch({ effects: setErrorLine.of(lineNo) });
      }
    } else {
      // Clear error decoration
      view.dispatch({ effects: setErrorLine.of(null) });
    }
  }, [queryError]);

  // Load history
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const entries = await getHistory();
      setHistoryEntries(entries.slice(0, 20));
    } catch {
      // silently fail
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
    loadHistory();
  }, [loadHistory]);

  const handleHistorySelect = useCallback(
    async (entry: HistoryEntry) => {
      try {
        const sql = await getHistoryEntry(entry.id);
        setContent(sql);
        setHistoryOpen(false);
      } catch {
        // silently fail
      }
    },
    [setContent]
  );

  // Close on Escape
  useEffect(() => {
    if (!historyOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHistoryOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [historyOpen]);

  useEffect(() => {
    if (!containerRef.current) return;

    const darkTheme = EditorView.theme(
      {
        "&": {
          backgroundColor: "var(--bg-primary)",
          color: "var(--text-primary)",
          height: "100%",
          fontSize: "16px",
        },
        ".cm-content": {
          fontFamily: "var(--font-mono)",
          fontSize: "17px",
          caretColor: "var(--accent)",
          padding: "8px 0",
        },
        ".cm-gutters": {
          backgroundColor: "var(--bg-secondary)",
          color: "var(--text-dimmed)",
          border: "none",
          borderRight: "1px solid var(--border)",
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          minWidth: "40px",
        },
        ".cm-gutter": {
          minWidth: "40px",
        },
        ".cm-activeLine": {
          backgroundColor: "rgba(0, 216, 255, 0.03)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "rgba(0, 216, 255, 0.05)",
          color: "var(--text-secondary)",
        },
        ".cm-selectionBackground, ::selection": {
          backgroundColor: "var(--accent-dimmed) !important",
        },
        ".cm-cursor": {
          borderLeftColor: "var(--accent)",
          borderLeftWidth: "1.5px",
        },
        ".cm-matchingBracket": {
          backgroundColor: "rgba(0, 216, 255, 0.12)",
          outline: "none",
        },
        ".cm-line": {
          padding: "0 8px",
        },
        ".cm-foldPlaceholder": {
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-dimmed)",
          border: "1px solid var(--border)",
          borderRadius: "0",
        },
        ".cm-tooltip": {
          backgroundColor: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "0",
          color: "var(--text-primary)",
        },
        ".cm-tooltip-autocomplete": {
          "& > ul > li": {
            padding: "2px 8px",
          },
          "& > ul > li[aria-selected]": {
            backgroundColor: "var(--accent-dimmed)",
            color: "var(--text-primary)",
          },
        },
        ".cm-panels": {
          backgroundColor: "var(--bg-secondary)",
          color: "var(--text-primary)",
          borderTop: "1px solid var(--border)",
        },
        ".cm-panel.cm-search": {
          padding: "4px 8px",
        },
        ".cm-panel.cm-search input": {
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          borderRadius: "0",
          fontFamily: "var(--font-mono)",
          fontSize: "14px",
        },
        ".cm-panel.cm-search button": {
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
          borderRadius: "0",
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
        },
        ".cm-error-line": {
          backgroundColor: "rgba(255, 60, 60, 0.08)",
          borderLeft: "2px solid #ff3c3c",
        },
      },
      { dark: true }
    );

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        sql(),
        darkTheme,
        errorLineField,
        Prec.highest(
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: (view) => {
                // Guard: do not re-execute while a query is already running
                if (isQueryingRef.current) return true;
                const content = view.state.doc.toString();
                onExecuteRef.current?.(content);
                return true;
              },
            },
            {
              key: "Mod-k",
              preventDefault: true,
              run: (view) => {
                const sel = view.state.sliceDoc(
                  view.state.selection.main.from,
                  view.state.selection.main.to
                );
                onCmdKRef.current?.(sel || view.state.doc.toString(), view);
                return true;
              },
            },
            {
              key: "Mod-h",
              preventDefault: true,
              run: () => {
                openHistory();
                return true;
              },
            },
            {
              key: "Mod-l",
              preventDefault: true,
              run: () => {
                useStore.getState().toggleChatSidebar();
                return true;
              },
            },
          ])
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  // Only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderBottom: "1px solid var(--border)",
        position: "relative",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          height: 34,
          minHeight: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 14px",
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--font-ui)",
          fontSize: 14,
        }}
      >
        <span style={{ color: "var(--text-secondary)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          sql
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <span
            onClick={openHistory}
            className="medha-toolbar-btn"
            style={{ cursor: "pointer" }}
            title="Open history"
          >
            ⌘H History
          </span>
          <span className="medha-toolbar-sep" />
          <span className="medha-toolbar-btn">⌘K Edit</span>
          <span className="medha-toolbar-sep" />
          <span className="medha-toolbar-btn">⌘L Chat</span>
          <span className="medha-toolbar-sep" />
          {isQuerying ? (
            <span
              className="medha-toolbar-btn"
              style={{
                color: "#00D8FF",
                animation: "medha-pulse 1s ease-in-out infinite",
              }}
            >
              ⌘↵ Running...
            </span>
          ) : (
            <span
              className="medha-toolbar-btn"
              style={{ cursor: "pointer" }}
              onClick={() => {
                const content = viewRef.current?.state.doc.toString() || "";
                if (content) onExecuteRef.current?.(content);
              }}
            >
              ⌘↵ Run
            </span>
          )}
        </span>
      </div>

      {/* Toolbar + pulse animation styles */}
      <style>{`
        @keyframes medha-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .medha-toolbar-btn {
          color: #444;
          font-size: 14px;
          font-family: var(--font-mono);
          padding: 0 10px;
          transition: color 0.15s;
          white-space: nowrap;
        }
        .medha-toolbar-btn:hover {
          color: #00D8FF;
        }
        .medha-toolbar-sep {
          width: 1px;
          height: 10px;
          background: #1a1a1f;
          flex-shrink: 0;
        }
      `}</style>

      {/* Error banner below toolbar */}
      {queryError && (
        <div
          style={{
            padding: "4px 10px",
            background: "rgba(255, 60, 60, 0.08)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: "var(--font-mono)",
              color: "#ff3c3c",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {queryError}
          </span>
          <button
            onClick={onDismissError}
            style={{
              background: "none",
              border: "none",
              color: "#ff3c3c",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              padding: "0 4px",
              flexShrink: 0,
            }}
          >
            x
          </button>
        </div>
      )}

      {/* Editor container */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "auto",
        }}
      />

      {/* History popover */}
      {historyOpen && (
        <div
          style={{
            position: "absolute",
            top: 38,
            right: 14,
            width: 420,
            maxHeight: 450,
            background: "var(--bg-elevated, var(--bg-secondary))",
            border: "1px solid var(--border)",
            zIndex: 50,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 14,
              fontFamily: "var(--font-ui)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-dimmed)",
            }}
          >
            <span>query history</span>
            <button
              onClick={() => setHistoryOpen(false)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-dimmed)",
                cursor: "pointer",
                fontSize: 15,
                padding: "0 2px",
                fontFamily: "var(--font-mono)",
              }}
            >
              esc
            </button>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {historyLoading && (
              <div style={{ padding: 14, fontSize: 15, color: "var(--text-dimmed)", textAlign: "center", fontFamily: "var(--font-ui)" }}>
                loading...
              </div>
            )}
            {!historyLoading && historyEntries.length === 0 && (
              <div style={{ padding: 14, fontSize: 15, color: "var(--text-dimmed)", textAlign: "center", fontFamily: "var(--font-ui)" }}>
                no history
              </div>
            )}
            {historyEntries.map((entry) => {
              const timePart = entry.timestamp
                ? entry.timestamp.split(" ")[1]?.slice(0, 5) || ""
                : "";
              const preview = entry.preview.slice(0, 60);
              return (
                <div
                  key={entry.id}
                  onClick={() => handleHistorySelect(entry)}
                  style={{
                    padding: "7px 14px",
                    cursor: "pointer",
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 15,
                    fontFamily: "var(--font-mono)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "var(--bg-tertiary)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  }}
                >
                  <span style={{ color: "var(--accent)", flexShrink: 0, fontSize: 14 }}>
                    {timePart}
                  </span>
                  <span
                    style={{
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {preview}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
