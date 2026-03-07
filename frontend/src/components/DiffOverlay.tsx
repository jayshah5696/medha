import { useState } from "react";
import DiffMatchPatch from "diff-match-patch";
import { format } from "sql-formatter";
import { inlineEdit } from "../lib/api";
import { useStore } from "../store";
import type { EditorView } from "@codemirror/view";

interface DiffOverlayProps {
  selectedSql: string;
  editorView: EditorView;
  onClose: () => void;
}

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  text: string;
}

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  const lines: DiffLine[] = [];

  for (const [op, text] of diffs) {
    const textLines = text.split("\n");
    for (let i = 0; i < textLines.length; i++) {
      const line = textLines[i];
      if (line === "" && i === textLines.length - 1) continue;

      if (op === 0) {
        lines.push({ type: "unchanged", text: line });
      } else if (op === -1) {
        lines.push({ type: "removed", text: line });
      } else if (op === 1) {
        lines.push({ type: "added", text: line });
      }
    }
  }

  return lines;
}

function formatSql(sqlStr: string): string {
  try {
    return format(sqlStr, { language: "sql", keywordCase: "upper" });
  } catch {
    return sqlStr;
  }
}

export default function DiffOverlay({
  selectedSql,
  editorView,
  onClose,
}: DiffOverlayProps) {
  const { activeFiles } = useStore();
  const [instruction, setInstruction] = useState("");
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
  const [newSql, setNewSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!instruction.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const result = await inlineEdit(
        instruction.trim(),
        selectedSql,
        activeFiles
      );

      const formattedOld = formatSql(selectedSql);
      const formattedNew = formatSql(result.sql);
      setNewSql(result.sql);
      setDiffLines(computeLineDiff(formattedOld, formattedNew));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = () => {
    const state = editorView.state;
    const { from, to } = state.selection.main;

    if (from === to) {
      editorView.dispatch({
        changes: { from: 0, to: state.doc.length, insert: newSql },
      });
    } else {
      editorView.dispatch({
        changes: { from, to, insert: newSql },
      });
    }
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-strong)",
          borderRadius: 0,
          width: 640,
          maxWidth: "90vw",
          maxHeight: "80vh",
          overflow: "auto",
          padding: 16,
        }}
      >
        {/* Title */}
        <div
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 500,
            marginBottom: 12,
            color: "var(--accent)",
            fontFamily: "var(--font-ui)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          inline edit
        </div>

        {/* Instruction input */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="e.g. Add a WHERE clause for active users"
            autoFocus
            style={{
              flex: 1,
              padding: "6px 8px",
              fontSize: 'var(--font-size-base)',
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: 0,
              color: "var(--text-primary)",
              outline: "none",
              fontFamily: "var(--font-mono)",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !instruction.trim()}
            style={{
              padding: "6px 12px",
              fontSize: 'var(--font-size-sm)',
              background: "transparent",
              color: "var(--accent)",
              border: "1px solid var(--border)",
              borderRadius: 0,
              cursor: "pointer",
              fontWeight: 500,
              fontFamily: "var(--font-ui)",
            }}
          >
            {loading ? "..." : "edit"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "6px 8px",
              background: "var(--diff-remove-bg)",
              color: "var(--error)",
              borderRadius: 0,
              fontSize: 'var(--font-size-xs)',
              marginBottom: 12,
              fontFamily: "var(--font-mono)",
            }}
          >
            {error}
          </div>
        )}

        {/* Diff view */}
        {diffLines && (
          <>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 'var(--font-size-sm)',
                lineHeight: 1.6,
                background: "var(--bg-secondary)",
                borderRadius: 0,
                padding: 8,
                overflow: "auto",
                maxHeight: 400,
                marginBottom: 12,
                border: "1px solid var(--border)",
              }}
            >
              {diffLines.map((line, i) => (
                <div
                  key={i}
                  style={{
                    background:
                      line.type === "added"
                        ? "var(--diff-add-bg)"
                        : line.type === "removed"
                          ? "var(--diff-remove-bg)"
                          : "transparent",
                    color:
                      line.type === "added"
                        ? "var(--diff-add-text)"
                        : line.type === "removed"
                          ? "var(--diff-remove-text)"
                          : "var(--text-primary)",
                    padding: "1px 8px",
                  }}
                >
                  <span style={{ opacity: 0.4, marginRight: 8 }}>
                    {line.type === "added"
                      ? "+"
                      : line.type === "removed"
                        ? "-"
                        : " "}
                  </span>
                  {line.text}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={onClose}
                style={{
                  padding: "5px 12px",
                  fontSize: 'var(--font-size-sm)',
                  background: "transparent",
                  color: "var(--text-dimmed)",
                  border: "1px solid var(--border)",
                  borderRadius: 0,
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                }}
              >
                reject
              </button>
              <button
                onClick={handleAccept}
                style={{
                  padding: "5px 12px",
                  fontSize: 'var(--font-size-sm)',
                  background: "transparent",
                  color: "var(--accent)",
                  border: "1px solid var(--border)",
                  borderRadius: 0,
                  cursor: "pointer",
                  fontWeight: 500,
                  fontFamily: "var(--font-ui)",
                }}
              >
                accept
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
