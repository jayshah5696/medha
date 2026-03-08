import { useEffect, useRef, useCallback, useState } from "react";
import { EditorState, StateField, StateEffect, Prec } from "@codemirror/state";
import { EditorView, keymap, Decoration, type DecorationSet } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";
import { basicSetup } from "codemirror";
import { Bot, User } from "lucide-react";
import { getHistory, getHistoryEntry, saveQuery } from "../lib/api";
import type { HistoryEntry } from "../lib/api";
import { useStore } from "../store";
import TabBar from "./TabBar";
import "./SqlEditor.css";

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

  // Sync editorContent from store (agent query results, history entries)
  const editorContent = useStore((s) => s.editorContent);
  const prevContentRef = useRef(editorContent);
  useEffect(() => {
    if (editorContent !== prevContentRef.current) {
      prevContentRef.current = editorContent;
      setContent(editorContent);
    }
  }, [editorContent, setContent]);

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
          fontSize: "var(--font-size-editor)",
        },
        ".cm-content": {
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-editor)",
          caretColor: "var(--accent)",
          padding: "8px 0",
        },
        ".cm-gutters": {
          backgroundColor: "var(--bg-secondary)",
          color: "var(--text-dimmed)",
          border: "none",
          borderRight: "1px solid var(--border)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-gutter)",
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
          fontSize: "var(--font-size-base)",
        },
        ".cm-panel.cm-search button": {
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
          borderRadius: "0",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-sm)",
        },
        ".cm-error-line": {
          backgroundColor: "rgba(255, 60, 60, 0.08)",
          borderLeft: "2px solid var(--error)",
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
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                const store = useStore.getState();
                const tab = store.tabs.find((t) => t.id === store.activeTabId);
                if (!tab) return true;
                const content = store.editorContent;
                saveQuery(tab.filename, content)
                  .then(() => {
                    store.markTabSaved(tab.id);
                    store.addToast(`Saved ${tab.filename}`);
                  })
                  .catch((err) => {
                    store.addToast(
                      `Save failed: ${err instanceof Error ? err.message : String(err)}`
                    );
                  });
                return true;
              },
            },
          ])
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString();
            onChangeRef.current?.(text);
            // Sync typed content to the active tab and store editorContent
            const store = useStore.getState();
            store.updateTabContent(store.activeTabId, text);
            store.setEditorContent(text);
            prevContentRef.current = text;
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
    <div className="se-root">
      {/* Toolbar */}
      <div className="se-toolbar">
        <span className="se-toolbar-label">
          sql
        </span>
        <span className="se-toolbar-actions">
          <span
            onClick={openHistory}
            className="se-toolbar-btn se-toolbar-btn--clickable"
            title="Open history"
          >
            ⌘H History
          </span>
          <span className="se-toolbar-sep" />
          <span className="se-toolbar-btn">⌘S Save</span>
          <span className="se-toolbar-sep" />
          <span className="se-toolbar-btn">⌘K Edit</span>
          <span className="se-toolbar-sep" />
          <span className="se-toolbar-btn">⌘L Chat</span>
          <span className="se-toolbar-sep" />
          {isQuerying ? (
            <span className="se-toolbar-btn se-toolbar-btn--running">
              ⌘↵ Running...
            </span>
          ) : (
            <span
              className="se-toolbar-btn se-toolbar-btn--clickable"
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

      {/* Tab bar */}
      <TabBar />

      {/* Error banner below toolbar */}
      {queryError && (
        <div className="se-error-banner">
          <span className="se-error-text">
            {queryError}
          </span>
          <button onClick={onDismissError} className="se-error-dismiss">
            x
          </button>
        </div>
      )}

      {/* Editor container */}
      <div ref={containerRef} className="se-editor" />

      {/* History popover */}
      {historyOpen && (
        <div className="se-history">
          <div className="se-history-header">
            <span>query history</span>
            <button
              onClick={() => setHistoryOpen(false)}
              className="se-history-close"
            >
              esc
            </button>
          </div>
          <div className="se-history-list">
            {historyLoading && (
              <div className="se-history-status">
                loading...
              </div>
            )}
            {!historyLoading && historyEntries.length === 0 && (
              <div className="se-history-status">
                no history
              </div>
            )}
            {historyEntries.map((entry) => {
              const timePart = entry.timestamp
                ? entry.timestamp.split(" ")[1]?.slice(0, 5) || ""
                : "";
              const preview = entry.preview.slice(0, 55);
              const SourceIcon = entry.source === "agent" ? Bot : User;
              return (
                <div
                  key={entry.id}
                  onClick={() => handleHistorySelect(entry)}
                  className="se-history-entry"
                >
                  <span className="se-history-entry-icon">
                    <SourceIcon size={11} />
                  </span>
                  <span className="se-history-entry-time">
                    {timePart}
                  </span>
                  <span className="se-history-entry-preview">
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
