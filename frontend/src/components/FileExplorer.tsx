import { useState, useEffect, useMemo } from "react";
import { useStore } from "../store";
import { configureWorkspace, getFiles, getHistory, getHistoryEntry, clearHistory } from "../lib/api";
import type { HistoryEntry } from "../lib/api";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileExplorer() {
  const {
    workspacePath,
    setWorkspacePath,
    files,
    setFiles,
    activeFiles,
    toggleActiveFile,
    setLastError,
    loadHistoryEntry,
  } = useStore();

  const [inputPath, setInputPath] = useState(workspacePath);
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [fileFilter, setFileFilter] = useState("");

  // Only show the filter input when there are more than 10 files
  const showFilter = files.length > 10;

  const filteredFiles = useMemo(() => {
    if (!fileFilter.trim()) return files;
    const lower = fileFilter.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(lower));
  }, [files, fileFilter]);

  const loadHistory = async () => {
    try {
      const entries = await getHistory();
      setHistoryEntries(entries.slice(0, 10));
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    if (historyOpen) {
      loadHistory();
    }
  }, [historyOpen]);

  const handleConfigure = async () => {
    if (!inputPath.trim()) return;
    setLoading(true);
    try {
      await configureWorkspace(inputPath.trim());
      setWorkspacePath(inputPath.trim());
      const fileList = await getFiles();
      setFiles(fileList);
      setLastError(null);
      setFileFilter("");
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleHistoryClick = async (entry: HistoryEntry) => {
    try {
      const sql = await getHistoryEntry(entry.id);
      loadHistoryEntry(sql);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClearHistory = async () => {
    try {
      await clearHistory();
      setHistoryEntries([]);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      style={{
        width: "var(--sidebar-left)",
        minWidth: "var(--sidebar-left)",
        background: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Workspace config section */}
      <div style={{ padding: "10px 10px 8px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            textTransform: "uppercase",
            color: "var(--text-dimmed)",
            marginBottom: 8,
            letterSpacing: "0.08em",
            fontFamily: "var(--font-ui)",
            fontVariant: "small-caps",
          }}
        >
          workspace
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-dimmed)",
              padding: "5px 4px 5px 6px",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRight: "none",
              borderRadius: 0,
              fontFamily: "var(--font-mono)",
              lineHeight: 1,
            }}
          >
            &gt;
          </span>
          <input
            type="text"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder="/path/to/data"
            onKeyDown={(e) => e.key === "Enter" && handleConfigure()}
            style={{
              flex: 1,
              padding: "5px 6px",
              fontSize: 12,
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: 0,
              color: "var(--text-primary)",
              outline: "none",
              fontFamily: "var(--font-mono)",
              width: "100%",
              minWidth: 0,
            }}
          />
        </div>
        <button
          onClick={handleConfigure}
          disabled={loading}
          className="medha-btn"
          style={{
            width: "100%",
            marginTop: 6,
          }}
        >
          {loading ? "loading..." : "configure"}
        </button>
      </div>

      {/* File list */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "4px 0",
        }}
      >
        {/* File filter input (only shown when >10 files) */}
        {showFilter && (
          <div style={{ padding: "4px 10px 4px" }}>
            <input
              type="text"
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder="filter files..."
              style={{
                width: "100%",
                padding: "3px 6px",
                fontSize: 11,
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border)",
                borderRadius: 0,
                color: "var(--text-primary)",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>
        )}

        {files.length === 0 && (
          <div
            style={{
              padding: "24px 16px",
              fontSize: 11,
              color: "#333",
              textAlign: "center",
              fontFamily: "var(--font-mono)",
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
              no files
            </div>
            <div>
              Set a workspace directory above
              <br />
              to load Parquet, CSV, or JSON files.
            </div>
          </div>
        )}
        {filteredFiles.map((f) => {
          const isActive = activeFiles.includes(f.name);
          return (
            <div
              key={f.name}
              onClick={() => toggleActiveFile(f.name)}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: isActive ? "var(--bg-tertiary)" : "transparent",
                borderLeft: isActive
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                fontFamily: "var(--font-mono)",
                lineHeight: "20px",
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {f.name}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-dimmed)",
                  marginLeft: 8,
                  flexShrink: 0,
                  fontFamily: "var(--font-ui)",
                }}
              >
                {formatBytes(f.size_bytes)}
              </span>
            </div>
          );
        })}

        {/* History section */}
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 4 }}>
          <div
            onClick={() => setHistoryOpen(!historyOpen)}
            style={{
              padding: "6px 10px",
              fontSize: 10,
              fontWeight: 500,
              textTransform: "uppercase",
              color: "var(--text-dimmed)",
              letterSpacing: "0.08em",
              fontFamily: "var(--font-ui)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              userSelect: "none",
            }}
          >
            <span style={{ fontSize: 8 }}>{historyOpen ? "\u25BC" : "\u25B6"}</span>
            history
          </div>
          {historyOpen && (
            <div>
              {historyEntries.length === 0 && (
                <div
                  style={{
                    padding: "8px 10px",
                    fontSize: 11,
                    color: "var(--text-dimmed)",
                    fontFamily: "var(--font-ui)",
                    textAlign: "center",
                  }}
                >
                  no history
                </div>
              )}
              {historyEntries.map((entry) => {
                const timePart = entry.timestamp ? entry.timestamp.split(" ")[1]?.slice(0, 5) || "" : "";
                const previewText = entry.preview.slice(0, 40);
                return (
                  <div
                    key={entry.id}
                    onClick={() => handleHistoryClick(entry)}
                    style={{
                      padding: "3px 10px",
                      fontSize: 11,
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontFamily: "var(--font-mono)",
                      gap: 6,
                    }}
                    title={entry.preview}
                  >
                    <span style={{ color: "var(--text-secondary)", flexShrink: 0, fontSize: 10 }}>
                      {timePart}
                    </span>
                    <span
                      style={{
                        color: "var(--text-dimmed)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 10,
                      }}
                    >
                      {previewText}
                    </span>
                  </div>
                );
              })}
              {historyEntries.length > 0 && (
                <div style={{ padding: "4px 10px 6px", textAlign: "center" }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearHistory();
                    }}
                    className="medha-btn"
                    style={{
                      fontSize: 9,
                      padding: "2px 8px",
                    }}
                  >
                    clear
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
