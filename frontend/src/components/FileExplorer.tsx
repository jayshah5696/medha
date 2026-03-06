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
        width: 240,
        minWidth: 240,
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div style={{ padding: "12px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            color: "var(--text-secondary)",
            marginBottom: 8,
            letterSpacing: "0.05em",
          }}
        >
          Workspace
        </div>
        <input
          type="text"
          value={inputPath}
          onChange={(e) => setInputPath(e.target.value)}
          placeholder="/path/to/data"
          onKeyDown={(e) => e.key === "Enter" && handleConfigure()}
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 12,
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text-primary)",
            marginBottom: 6,
            outline: "none",
          }}
        />
        <button
          onClick={handleConfigure}
          disabled={loading}
          style={{
            width: "100%",
            padding: "6px",
            fontSize: 12,
            background: "var(--accent)",
            color: "#1e1e2e",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Loading..." : "Configure"}
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px 0",
        }}
      >
        {files.length === 0 && (
          <div
            style={{
              padding: "12px",
              fontSize: 12,
              color: "var(--text-secondary)",
              textAlign: "center",
            }}
          >
            No files. Configure a workspace above.
          </div>
        )}
        {files.map((f) => {
          const isActive = activeFiles.includes(f.name);
          return (
            <div
              key={f.name}
              onClick={() => toggleActiveFile(f.name)}
              style={{
                padding: "6px 12px",
                fontSize: 13,
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: isActive ? "var(--bg-tertiary)" : "transparent",
                borderLeft: isActive
                  ? "3px solid var(--accent)"
                  : "3px solid transparent",
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  marginLeft: 8,
                  flexShrink: 0,
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
