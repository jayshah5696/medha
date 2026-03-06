import { useState } from "react";
import { useStore } from "../store";
import { configureWorkspace, getFiles } from "../lib/api";

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
  } = useStore();

  const [inputPath, setInputPath] = useState(workspacePath);
  const [loading, setLoading] = useState(false);

  const handleConfigure = async () => {
    if (!inputPath.trim()) return;
    setLoading(true);
    try {
      await configureWorkspace(inputPath.trim());
      setWorkspacePath(inputPath.trim());
      const fileList = await getFiles();
      setFiles(fileList);
      setLastError(null);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
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
          style={{
            width: "100%",
            padding: "4px",
            fontSize: 11,
            background: "transparent",
            color: "var(--accent)",
            border: "1px solid var(--border)",
            borderRadius: 0,
            cursor: "pointer",
            fontWeight: 500,
            fontFamily: "var(--font-ui)",
            marginTop: 6,
            letterSpacing: "0.04em",
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
        {files.length === 0 && (
          <div
            style={{
              padding: "16px 10px",
              fontSize: 11,
              color: "var(--text-dimmed)",
              textAlign: "center",
              fontFamily: "var(--font-ui)",
            }}
          >
            no files loaded
          </div>
        )}
        {files.map((f) => {
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
      </div>
    </div>
  );
}
