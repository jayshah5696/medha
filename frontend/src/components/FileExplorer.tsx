import { useState, useEffect, useMemo } from "react";
import { FolderOpen, FolderClosed, FileText, ArrowUp, Bot, User } from "lucide-react";
import { useStore } from "../store";
import { configureWorkspace, getFiles, getHistory, getHistoryEntry, clearHistory, browseDirectory, runQuery } from "../lib/api";
import type { HistoryEntry, DirEntry } from "../lib/api";
import SidebarSection from "./SidebarSection";
import "./FileExplorer.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- File tree types & utilities (BUG-8-6) ---

interface FileTreeNode {
  name: string;
  fullPath?: string;
  size_bytes?: number;
  children?: FileTreeNode[];
}

function buildFileTree(files: { name: string; size_bytes: number }[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const file of files) {
    const parts = file.name.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        current.push({
          name: part,
          fullPath: file.name,
          size_bytes: file.size_bytes,
        });
      } else {
        let dirNode = current.find((n) => n.name === part && n.children);
        if (!dirNode) {
          dirNode = { name: part, children: [] };
          current.push(dirNode);
        }
        current = dirNode.children!;
      }
    }
  }
  return root;
}

function hasNesting(files: { name: string }[]): boolean {
  return files.some((f) => f.name.includes("/"));
}

function FileTreeItem({
  node,
  depth,
  onFileClick,
  activeFiles,
}: {
  node: FileTreeNode;
  depth: number;
  onFileClick: (fullPath: string, e: React.MouseEvent) => void;
  activeFiles: string[];
}) {
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 16;

  if (node.children) {
    return (
      <>
        <div
          onClick={() => setExpanded(!expanded)}
          className="fe-tree-folder"
          style={{ paddingLeft: 12 + indent }}
        >
          <span className="fe-tree-chevron">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
          <span
            className="fe-tree-folder-name"
            title={node.name}
          >
            {node.name}/
          </span>
        </div>
        {expanded &&
          node.children.map((child) => (
            <FileTreeItem
              key={child.fullPath || child.name}
              node={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              activeFiles={activeFiles}
            />
          ))}
      </>
    );
  }

  // Leaf file
  const isActive = activeFiles.includes(node.fullPath || "");
  return (
    <div
      onClick={(e) => onFileClick(node.fullPath!, e)}
      className={`fe-file ${isActive ? "fe-file--active" : ""}`}
      style={{ paddingLeft: 12 + indent }}
    >
      <span
        className="fe-file-name"
        title={node.fullPath}
      >
        {node.name}
      </span>
      <span className="fe-file-size">
        {formatBytes(node.size_bytes!)}
      </span>
    </div>
  );
}

// --- FileExplorer component ---

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
    clearActiveFiles,
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

  // File System Access API detection (Spec §14B)
  const hasNativePicker = typeof window !== "undefined" && "showDirectoryPicker" in window;

  const handleNativePicker = async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      if (dirHandle && dirHandle.name) {
        setInputPath(dirHandle.name);
      }
    } catch {
      // User cancelled the picker or API error — silently ignore
    }
  };

  // Auto-configure workspace on mount if path exists in store
  useEffect(() => {
    if (workspacePath && files.length === 0) {
      configureWorkspace(workspacePath)
        .then(() => getFiles())
        .then(setFiles)
        .catch((e) => setLastError(e instanceof Error ? e.message : String(e)));
    }
  }, []);

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

  // Show the filter input always
  const showFilter = true;

  const filteredFiles = useMemo(() => {
    if (!fileFilter.trim()) return files;
    const lower = fileFilter.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(lower));
  }, [files, fileFilter]);

  // BUG-8-6: Build tree view when files have nested paths
  const useTree = useMemo(() => hasNesting(filteredFiles), [filteredFiles]);
  const fileTree = useMemo(
    () => (useTree ? buildFileTree(filteredFiles) : []),
    [useTree, filteredFiles]
  );

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
  const handleFilePreview = async (filename: string, e?: React.MouseEvent) => {
    const query = `SELECT * FROM '${filename}' LIMIT 100;`;
    setEditorContent(query);
    
    // Only toggle active file if shift key is pressed
    if (e?.shiftKey) {
      toggleActiveFile(filename);
      return;
    }

    if (onFilePreview) {
      onFilePreview(query);
    } else {
      // Execute directly if no callback provided
      setIsQuerying(true);
      setLastError(null);
      try {
        const qid = crypto.randomUUID();
        const result = await runQuery(query, qid, "json", 0, 500);
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
      clearActiveFiles();
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
      className="fe-root"
      style={{ width: width, minWidth: width }}
    >
      {/* Workspace config section */}
      <SidebarSection title="workspace">
        <div className="fe-workspace-body">
          <div className="fe-workspace-row">
            <span className="fe-workspace-prompt">
              &gt;
            </span>
            <input
              type="text"
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              placeholder="/path/to/data"
              onKeyDown={(e) => e.key === "Enter" && handleConfigure()}
              className="fe-workspace-input"
            />
          </div>
          <div className="fe-workspace-actions">
            <button
              onClick={handleConfigure}
              disabled={loading}
              className="medha-btn fe-btn-configure"
            >
              {loading ? "loading..." : "configure"}
            </button>
            {hasNativePicker && (
              <button
                onClick={handleNativePicker}
                className="medha-btn fe-btn-icon"
                title="Open native folder picker"
              >
                <FolderOpen size={14} />
               
              </button>
            )}
            <button
              onClick={() => openBrowser(inputPath || "")}
              className="medha-btn fe-btn-icon"
              title="Browse folders"
            >
               <FolderClosed size={14} />
             
            </button>
          </div>
        </div>
      </SidebarSection>

      {/* File list */}
      <div className="fe-file-list">
        <div className="fe-file-header">
          <span className="fe-file-header-label">
            Files
          </span>
          {activeFiles.length > 0 && (
            <button
              onClick={clearActiveFiles}
              className="fe-clear-btn"
            >
              Clear selected
            </button>
          )}
        </div>

        {/* File filter input (only shown when >10 files) */}
        {showFilter && (
          <div className="fe-filter-wrap">
            <input
              type="text"
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder="filter files..."
              className="fe-filter-input"
            />
          </div>
        )}

        {files.length === 0 && (
          <div className="fe-empty-state">
            <div className="fe-empty-state-title">
              no files
            </div>
            <div>
              Set a workspace directory above
              <br />
              to load Parquet, CSV, or JSON files.
            </div>
          </div>
        )}
        {useTree
          ? fileTree.map((node) => (
              <FileTreeItem
                key={node.fullPath || node.name}
                node={node}
                depth={0}
                onFileClick={handleFilePreview}
                activeFiles={activeFiles}
              />
            ))
          : filteredFiles.map((f) => {
              const isActive = activeFiles.includes(f.name);
              return (
                <div
                  key={f.name}
                  onClick={(e) => handleFilePreview(f.name, e)}
                  className={`fe-file ${isActive ? "fe-file--active" : ""}`}
                >
                  <span
                    className="fe-file-name"
                    title={f.name}
                  >
                    {f.name}
                  </span>
                  <span className="fe-file-size">
                    {formatBytes(f.size_bytes)}
                  </span>
                </div>
              );
            })}

        {/* History section */}
        <SidebarSection
          title="history"
          defaultOpen={false}
          onToggle={(open) => { if (open) setHistoryOpen(true); else setHistoryOpen(false); }}
          actions={
            historyEntries.length > 0 ? (
              <button
                onClick={handleClearHistory}
                className="medha-btn fe-history-clear-btn"
              >
                clear
              </button>
            ) : undefined
          }
        >
            <div>
              {historyEntries.length === 0 && (
                <div className="fe-history-empty">
                  no history
                </div>
              )}
              {historyEntries.map((entry) => {
                const timePart = entry.timestamp ? entry.timestamp.split(" ")[1]?.slice(0, 5) || "" : "";
                const previewText = entry.preview.slice(0, 36);
                const SourceIcon = entry.source === "agent" ? Bot : User;
                return (
                  <div
                    key={entry.id}
                    onClick={() => handleHistoryClick(entry)}
                    className="fe-history-entry"
                    title={`${entry.source === "agent" ? "Agent" : "User"} ${entry.preview}`}
                  >
                    <span className="fe-history-icon">
                      <SourceIcon size={11} />
                    </span>
                    <span className="fe-history-time">
                      {timePart}
                    </span>
                    <span className="fe-history-preview">
                      {previewText}
                    </span>
                  </div>
                );
              })}
            </div>
        </SidebarSection>
      </div>

      {/* Folder browser overlay */}
      {browseOpen && (
        <div
          className="fe-browse-overlay"
          onClick={() => setBrowseOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="fe-browse-modal"
          >
            {/* Header */}
            <div className="fe-browse-header">
              <span>select folder</span>
              <button
                onClick={() => setBrowseOpen(false)}
                className="fe-browse-close-btn"
              >
                esc
              </button>
            </div>

            {/* Current path */}
            <div
              className="fe-browse-path"
              title={browsePath}
            >
              {browsePath}
            </div>

            {/* Directory list */}
            <div className="fe-browse-list">
              {browseLoading && (
                <div className="fe-browse-loading">
                  loading...
                </div>
              )}

              {!browseLoading && browseParent && (
                <div
                  onClick={() => openBrowser(browseParent!)}
                  className="fe-browse-parent"
                >
                  <ArrowUp size={14} />
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
                    className={`fe-browse-entry ${entry.is_dir ? "fe-browse-entry--dir" : "fe-browse-entry--file"}`}
                  >
                    <span className="fe-browse-entry-icon">
                      {entry.is_dir ? <FolderClosed size={14} /> : <FileText size={14} />}
                    </span>
                    <span className="fe-browse-entry-name">
                      {entry.name}
                    </span>
                  </div>
                ))}

              {!browseLoading && browseEntries.length === 0 && (
                <div className="fe-browse-empty">
                  empty directory
                </div>
              )}
            </div>

            {/* Footer: select this folder */}
            <div className="fe-browse-footer">
              <button
                onClick={() => setBrowseOpen(false)}
                className="medha-btn fe-browse-cancel-btn"
              >
                cancel
              </button>
              <button
                onClick={() => handleBrowseSelect(browsePath)}
                className="medha-btn fe-browse-select-btn"
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
