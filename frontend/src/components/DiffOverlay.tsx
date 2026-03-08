import { useState } from "react";
import DiffMatchPatch from "diff-match-patch";
import { format } from "sql-formatter";
import { inlineEdit } from "../lib/api";
import { useStore } from "../store";
import type { EditorView } from "@codemirror/view";
import "./DiffOverlay.css";

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
      className="do-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="do-panel">
        {/* Title */}
        <div className="do-title">
          inline edit
        </div>

        {/* Instruction input */}
        <div className="do-input-row">
          <input
            type="text"
            className="do-input"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="e.g. Add a WHERE clause for active users"
            autoFocus
          />
          <button
            className="do-submit-btn"
            onClick={handleSubmit}
            disabled={loading || !instruction.trim()}
          >
            {loading ? "..." : "edit"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="do-error">
            {error}
          </div>
        )}

        {/* Diff view */}
        {diffLines && (
          <>
            <div className="do-diff-container">
              {diffLines.map((line, i) => (
                <div
                  key={i}
                  className={`do-diff-line do-diff-line-${line.type}`}
                >
                  <span className="do-diff-gutter">
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
            <div className="do-actions">
              <button className="do-reject-btn" onClick={onClose}>
                reject
              </button>
              <button className="do-accept-btn" onClick={handleAccept}>
                accept
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
