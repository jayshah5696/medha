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

function formatSql(sql: string): string {
  try {
    return format(sql, { language: "sql", keywordCase: "upper" });
  } catch {
    return sql;
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
      // No selection: replace entire doc
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
        background: "rgba(0,0,0,0.5)",
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
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: 600,
          maxHeight: "80vh",
          overflow: "auto",
          padding: 20,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 12,
            color: "var(--accent)",
          }}
        >
          Cmd+K: Inline Edit
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="e.g. Add a WHERE clause for active users"
            autoFocus
            style={{
              flex: 1,
              padding: "8px 12px",
              fontSize: 13,
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !instruction.trim()}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              background: "var(--accent)",
              color: "#1e1e2e",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? "..." : "Edit"}
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: "8px 12px",
              background: "rgba(243, 139, 168, 0.15)",
              color: "var(--error)",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {diffLines && (
          <>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                lineHeight: 1.6,
                background: "var(--bg-secondary)",
                borderRadius: 8,
                padding: 12,
                overflow: "auto",
                maxHeight: 400,
                marginBottom: 12,
              }}
            >
              {diffLines.map((line, i) => (
                <div
                  key={i}
                  style={{
                    background:
                      line.type === "added"
                        ? "rgba(166, 227, 161, 0.15)"
                        : line.type === "removed"
                          ? "rgba(243, 139, 168, 0.15)"
                          : "transparent",
                    color:
                      line.type === "added"
                        ? "var(--success)"
                        : line.type === "removed"
                          ? "var(--error)"
                          : "var(--text-primary)",
                    padding: "1px 8px",
                  }}
                >
                  <span style={{ opacity: 0.5, marginRight: 8 }}>
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

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  background: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Reject
              </button>
              <button
                onClick={handleAccept}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  background: "var(--success)",
                  color: "#1e1e2e",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Accept
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
