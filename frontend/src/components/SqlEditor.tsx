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
        },
        ".cm-content": {
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "14px",
          caretColor: "var(--accent)",
        },
        ".cm-gutters": {
          backgroundColor: "var(--bg-secondary)",
          color: "var(--text-secondary)",
          border: "none",
        },
        ".cm-activeLine": { backgroundColor: "rgba(69, 71, 90, 0.3)" },
        ".cm-activeLineGutter": { backgroundColor: "rgba(69, 71, 90, 0.3)" },
        ".cm-selectionBackground, ::selection": {
          backgroundColor: "rgba(137, 180, 250, 0.2) !important",
        },
        ".cm-cursor": { borderLeftColor: "var(--accent)" },
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
      ref={containerRef}
      style={{
        flex: 1,
        overflow: "auto",
        borderBottom: "1px solid var(--border)",
      }}
    />
  );
}
