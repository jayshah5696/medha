import { useEffect, useRef, useCallback } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";
import { basicSetup } from "codemirror";

interface SqlEditorProps {
  initialValue?: string;
  onExecute?: (query: string) => void;
  onCmdK?: (selectedText: string, view: EditorView) => void;
  onChange?: (value: string) => void;
}

export default function SqlEditor({
  initialValue = "SELECT 1;",
  onExecute,
  onCmdK,
  onChange,
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const onExecuteRef = useRef(onExecute);
  onExecuteRef.current = onExecute;
  const onCmdKRef = useRef(onCmdK);
  onCmdKRef.current = onCmdK;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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

  useEffect(() => {
    if (!containerRef.current) return;

    const darkTheme = EditorView.theme(
      {
        "&": {
          backgroundColor: "var(--bg-primary)",
          color: "var(--text-primary)",
          height: "100%",
          fontSize: "13px",
        },
        ".cm-content": {
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          caretColor: "var(--accent)",
          padding: "8px 0",
        },
        ".cm-gutters": {
          backgroundColor: "var(--bg-secondary)",
          color: "var(--text-dimmed)",
          border: "none",
          borderRight: "1px solid var(--border)",
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          minWidth: "36px",
        },
        ".cm-gutter": {
          minWidth: "36px",
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
          fontSize: "12px",
        },
        ".cm-panel.cm-search button": {
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
          borderRadius: "0",
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
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
        keymap.of([
          {
            key: "Mod-Enter",
            run: (view) => {
              const content = view.state.doc.toString();
              onExecuteRef.current?.(content);
              return true;
            },
          },
          {
            key: "Mod-k",
            run: (view) => {
              const sel = view.state.sliceDoc(
                view.state.selection.main.from,
                view.state.selection.main.to
              );
              onCmdKRef.current?.(sel || view.state.doc.toString(), view);
              return true;
            },
          },
        ]),
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
      }}
    >
      {/* Thin top bar */}
      <div
        style={{
          height: 24,
          minHeight: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px",
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--font-ui)",
          fontSize: 10,
        }}
      >
        <span style={{ color: "var(--text-secondary)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          sql
        </span>
        <span style={{ color: "var(--text-dimmed)" }}>
          Cmd+Enter to run / Cmd+K to edit
        </span>
      </div>

      {/* Editor container */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "auto",
        }}
      />
    </div>
  );
}
