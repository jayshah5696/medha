import { useState, useEffect, useMemo } from "react";
import { useStore } from "../store";
import { configureWorkspace, getFiles, getHistory, getHistoryEntry, clearHistory, browseDirectory, runQuery } from "../lib/api";
import type { HistoryEntry, DirEntry } from "../lib/api";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileExplorerProps {
  width: number;
  onFilePreview?: (query: string) => void;
}

export default function FileExplorer({ width, onFilePreview }: FileExplorerProps) {
  const {
    workspacePath,
    setWorkspacePath,
    files,
    setFiles,
    activeFiles,
    toggleActiveFile,
    setLastError,
    loadHistoryEntry,
    historyVersion,
    setEditorContent,
    setQueryResult,
    setIsQuerying,
    bumpHistoryVersion,
  } = useStore();

  const [inputPath, setInputPath] = useState(workspacePath);
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [fileFilter, setFileFilter] = useState("");

  // Folder browser state
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [browseEntries, setBrowseEntries] = useState<DirEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  const openBrowser = async (path?: string) => {
    setBrowseLoading(true);
    setBrowseOpen(true);
    try {
      const result = await browseDirectory(path || "");
      setBrowsePath(result.current);
      setBrowseParent(result.parent);
      setBrowseEntries(result.entries);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowseLoading(false);
    }
  };

  const handleBrowseSelect = (dir: string) => {
    setInputPath(dir);
    setBrowseOpen(false);
  };

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

  // BUG-4: auto-refresh history when historyVersion changes (query executed)
  useEffect(() => {
    if (historyOpen) {
      loadHistory();
    }
  }, [historyOpen, historyVersion]);

  // FEAT-2: Click file → auto-preview data in result grid
  const handleFilePreview = async (filename: string) => {
    const query = `SELECT * FROM '${filename}' LIMIT 100;`;
    setEditorContent(query);
    toggleActiveFile(filename);

    if (onFilePreview) {
      onFilePreview(query);
    } else {
      // Execute directly if no callback provided
      setIsQuerying(true);
      setLastError(null);
      try {
        const qid = crypto.randomUUID();
        const result = await runQuery(query, qid);
        setQueryResult(result);
        bumpHistoryVersion();
      } catch (e) {
        setLastError(e instanceof Error ? e.message : String(e));
        setQueryResult(null);
      } finally {
        setIsQuerying(false);
      }
    }
  };

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
        width: width,
        minWidth: width,
        background: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Workspace config section */}
      <div style={{ padding: "12px 12px 10px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            fontSize: 'var(--font-size-sm)',
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
              fontSize: 'var(--font-size-md)',
              color: "var(--text-dimmed)",
              padding: "7px 6px 7px 8px",
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
              padding: "7px 8px",
              fontSize: 'var(--font-size-base)',
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
        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          <button
            onClick={handleConfigure}
            disabled={loading}
            className="medha-btn"
            style={{ flex: 1 }}
          >
            {loading ? "loading..." : "configure"}
          </button>
          <button
            onClick={() => openBrowser(inputPath || "")}
            className="medha-btn"
            title="Browse folders"
            style={{ padding: "4px 8px", flexShrink: 0 }}
          >
            📁
          </button>
        </div>
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
          <div style={{ padding: "4px 12px 4px" }}>
            <input
              type="text"
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder="filter files..."
              style={{
                width: "100%",
                padding: "5px 8px",
                fontSize: 'var(--font-size-base)',
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
              fontSize: 'var(--font-size-base)',
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
              onClick={() => handleFilePreview(f.name)}
              style={{
                padding: "6px 12px",
                fontSize: 'var(--font-size-base)',
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: isActive ? "var(--bg-tertiary)" : "transparent",
                borderLeft: isActive
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                fontFamily: "var(--font-mono)",
                lineHeight: "24px",
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
                  fontSize: 'var(--font-size-xs)',
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
              padding: "8px 12px",
              fontSize: 'var(--font-size-sm)',
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
            <span style={{ fontSize: 'var(--font-size-sm)' }}>{historyOpen ? "\u25BC" : "\u25B6"}</span>
            history
          </div>
          {historyOpen && (
            <div>
              {historyEntries.length === 0 && (
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 'var(--font-size-base)',
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
                const previewText = entry.preview.slice(0, 36);
                const sourceIcon = entry.source === "agent" ? "🤖" : "👤";
                return (
                  <div
                    key={entry.id}
                    onClick={() => handleHistoryClick(entry)}
                    style={{
                      padding: "5px 12px",
                      fontSize: 'var(--font-size-base)',
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontFamily: "var(--font-mono)",
                      gap: 6,
                    }}
                    title={`${sourceIcon} ${entry.preview}`}
                  >
                    <span style={{ flexShrink: 0, fontSize: 'var(--font-size-xs)' }}>
                      {sourceIcon}
                    </span>
                    <span style={{ color: "var(--text-secondary)", flexShrink: 0, fontSize: 'var(--font-size-xs)' }}>
                      {timePart}
                    </span>
                    <span
                      style={{
                        color: "var(--text-dimmed)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 'var(--font-size-xs)',
                      }}
                    >
                      {previewText}
                    </span>
                  </div>
                );
              })}
              {historyEntries.length > 0 && (
                <div style={{ padding: "4px 12px 6px", textAlign: "center" }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearHistory();
                    }}
                    className="medha-btn"
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      padding: "4px 10px",
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

      {/* Folder browser overlay */}
      {browseOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setBrowseOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 480,
              maxHeight: "70vh",
              background: "var(--bg-elevated, var(--bg-secondary))",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 'var(--font-size-sm)',
                fontFamily: "var(--font-ui)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-dimmed)",
              }}
            >
              <span>select folder</span>
              <button
                onClick={() => setBrowseOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-dimmed)",
                  cursor: "pointer",
                  fontSize: 'var(--font-size-base)',
                  fontFamily: "var(--font-mono)",
                  padding: "0 2px",
                }}
              >
                esc
              </button>
            </div>

            {/* Current path */}
            <div
              style={{
                padding: "8px 14px",
                fontSize: 'var(--font-size-base)',
                fontFamily: "var(--font-mono)",
                color: "var(--accent)",
                borderBottom: "1px solid var(--border)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={browsePath}
            >
              {browsePath}
            </div>

            {/* Directory list */}
            <div style={{ flex: 1, overflow: "auto" }}>
              {browseLoading && (
                <div style={{ padding: 16, fontSize: 'var(--font-size-base)', color: "var(--text-dimmed)", textAlign: "center", fontFamily: "var(--font-ui)" }}>
                  loading...
                </div>
              )}

              {!browseLoading && browseParent && (
                <div
                  onClick={() => openBrowser(browseParent!)}
                  style={{
                    padding: "6px 14px",
                    fontSize: 'var(--font-size-base)',
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-secondary)",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "var(--bg-tertiary)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  }}
                >
                  <span style={{ fontSize: 'var(--font-size-md)' }}>↑</span>
                  <span>..</span>
                </div>
              )}

              {!browseLoading &&
                browseEntries.map((entry) => (
                  <div
                    key={entry.name}
                    onClick={() => {
                      if (entry.is_dir) {
                        openBrowser(browsePath + "/" + entry.name);
                      }
                    }}
                    style={{
                      padding: "5px 14px",
                      fontSize: 'var(--font-size-base)',
                      cursor: entry.is_dir ? "pointer" : "default",
                      fontFamily: "var(--font-mono)",
                      color: entry.is_dir ? "var(--text-primary)" : "var(--text-dimmed)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                    onMouseEnter={(e) => {
                      if (entry.is_dir) (e.currentTarget as HTMLDivElement).style.background = "var(--bg-tertiary)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = "transparent";
                    }}
                  >
                    <span style={{ fontSize: 'var(--font-size-base)', width: 20, textAlign: "center", flexShrink: 0 }}>
                      {entry.is_dir ? "📁" : "📄"}
                    </span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.name}
                    </span>
                  </div>
                ))}

              {!browseLoading && browseEntries.length === 0 && (
                <div style={{ padding: 16, fontSize: 'var(--font-size-base)', color: "var(--text-dimmed)", textAlign: "center", fontFamily: "var(--font-ui)" }}>
                  empty directory
                </div>
              )}
            </div>

            {/* Footer: select this folder */}
            <div
              style={{
                padding: "10px 14px",
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                onClick={() => setBrowseOpen(false)}
                className="medha-btn"
                style={{ fontSize: 'var(--font-size-sm)', padding: "5px 12px" }}
              >
                cancel
              </button>
              <button
                onClick={() => handleBrowseSelect(browsePath)}
                className="medha-btn"
                style={{
                  fontSize: 'var(--font-size-sm)',
                  padding: "5px 12px",
                  background: "var(--accent)",
                  color: "var(--bg-primary)",
                  fontWeight: 600,
                }}
              >
                select this folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
