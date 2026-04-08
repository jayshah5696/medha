import { useMemo, useState, useCallback } from "react";
import { useStore } from "../store";
import type { QueryResult } from "../lib/api";

interface RecordDetailSidebarProps {
  result: QueryResult;
  width: number;
}

/* ── JSON Value Renderer ────────────────────────────────────────────── */

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1);

  if (value === null) {
    return <span style={{ color: "var(--text-dimmed)", fontStyle: "italic" }}>null</span>;
  }

  if (typeof value === "boolean") {
    return <span style={{ color: "var(--warning)" }}>{String(value)}</span>;
  }

  if (typeof value === "number") {
    return <span style={{ color: "var(--accent)" }}>{String(value)}</span>;
  }

  if (typeof value === "string") {
    // Try to detect JSON strings and parse them
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(value);
        return <JsonValue value={parsed} depth={depth} />;
      } catch {
        // Not valid JSON, render as string
      }
    }
    return <span style={{ color: "var(--success)" }}>"{value}"</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span style={{ color: "var(--text-dimmed)" }}>[]</span>;
    }

    return (
      <span>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-dimmed)",
            cursor: "pointer",
            padding: 0,
            font: "inherit",
            fontSize: "var(--font-size-xs)",
          }}
          aria-label={collapsed ? "Expand array" : "Collapse array"}
        >
          {collapsed ? "▶" : "▼"}
        </button>
        {collapsed ? (
          <span style={{ color: "var(--text-dimmed)" }}>{` Array(${value.length})`}</span>
        ) : (
          <span>
            {"["}
            <div style={{ paddingLeft: 16 }}>
              {value.map((item, i) => (
                <div key={i} style={{ lineHeight: "22px" }}>
                  <span style={{ color: "var(--text-dimmed)", fontSize: "var(--font-size-xs)" }}>{i}: </span>
                  <JsonValue value={item} depth={depth + 1} />
                  {i < value.length - 1 && <span style={{ color: "var(--text-dimmed)" }}>,</span>}
                </div>
              ))}
            </div>
            {"]"}
          </span>
        )}
      </span>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span style={{ color: "var(--text-dimmed)" }}>{"{}"}</span>;
    }

    return (
      <span>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-dimmed)",
            cursor: "pointer",
            padding: 0,
            font: "inherit",
            fontSize: "var(--font-size-xs)",
          }}
          aria-label={collapsed ? "Expand object" : "Collapse object"}
        >
          {collapsed ? "▶" : "▼"}
        </button>
        {collapsed ? (
          <span style={{ color: "var(--text-dimmed)" }}>{` {${entries.length} keys}`}</span>
        ) : (
          <span>
            {"{"}
            <div style={{ paddingLeft: 16 }}>
              {entries.map(([key, val], i) => (
                <div key={key} style={{ lineHeight: "22px" }}>
                  <span style={{ color: "var(--accent)" }}>"{key}"</span>
                  <span style={{ color: "var(--text-dimmed)" }}>: </span>
                  <JsonValue value={val} depth={depth + 1} />
                  {i < entries.length - 1 && <span style={{ color: "var(--text-dimmed)" }}>,</span>}
                </div>
              ))}
            </div>
            {"}"}
          </span>
        )}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}

/* ── Field Value Display ────────────────────────────────────────────── */

function FieldValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span style={{ color: "var(--text-dimmed)", fontStyle: "italic" }}>null</span>;
  }

  if (typeof value === "object") {
    return (
      <div style={{ marginTop: 4 }}>
        <JsonValue value={value} depth={0} />
      </div>
    );
  }

  if (typeof value === "string") {
    // Auto-detect JSON inside strings
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(value);
        return (
          <div style={{ marginTop: 4 }}>
            <JsonValue value={parsed} depth={0} />
          </div>
        );
      } catch {
        // Not valid JSON
      }
    }
  }

  return <span style={{ wordBreak: "break-all" }}>{String(value)}</span>;
}

/* ── Type Badge ─────────────────────────────────────────────────────── */

function typeBadge(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/* ── Main Component ─────────────────────────────────────────────────── */

export default function RecordDetailSidebar({ result, width }: RecordDetailSidebarProps) {
  const selectedRowIndex = useStore((s) => s.selectedRowIndex);
  const setSelectedRowIndex = useStore((s) => s.setSelectedRowIndex);
  const setDetailOpen = useStore((s) => s.setDetailOpen);
  const addToast = useStore((s) => s.addToast);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "json">("table");

  const row = selectedRowIndex !== null ? result.rows[selectedRowIndex] : null;

  const filteredFields = useMemo(() => {
    if (!row) return [];
    const fields = result.columns.map((col, idx) => ({
      name: col,
      value: row[idx],
      index: idx,
    }));
    if (!searchQuery) return fields;
    const q = searchQuery.toLowerCase();
    return fields.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        String(f.value ?? "").toLowerCase().includes(q)
    );
  }, [row, result.columns, searchQuery]);

  const rowAsJson = useMemo(() => {
    if (!row) return {};
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  }, [row, result.columns]);

  const handleCopyField = useCallback(
    async (value: unknown) => {
      if (!navigator.clipboard?.writeText) return;
      const text =
        typeof value === "object" && value !== null
          ? JSON.stringify(value, null, 2)
          : String(value);
      await navigator.clipboard.writeText(text);
      addToast(`Copied ${text.slice(0, 32)}`);
    },
    [addToast]
  );

  const handleCopyRecord = useCallback(async () => {
    if (!navigator.clipboard?.writeText) return;
    const text = JSON.stringify(rowAsJson, null, 2);
    await navigator.clipboard.writeText(text);
    addToast("Copied full record");
  }, [rowAsJson, addToast]);

  const handlePrev = useCallback(() => {
    if (selectedRowIndex === null || selectedRowIndex <= 0) return;
    setSelectedRowIndex(selectedRowIndex - 1);
  }, [selectedRowIndex, setSelectedRowIndex]);

  const handleNext = useCallback(() => {
    if (selectedRowIndex === null || selectedRowIndex >= result.rows.length - 1) return;
    setSelectedRowIndex(selectedRowIndex + 1);
  }, [selectedRowIndex, setSelectedRowIndex, result.rows.length]);

  if (selectedRowIndex === null || !row) {
    return (
      <div
        style={{
          width,
          background: "var(--bg-secondary)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: "var(--font-size-sm)",
              fontFamily: "var(--font-ui)",
              color: "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Record Detail
          </span>
          <button
            type="button"
            onClick={() => setDetailOpen(false)}
            aria-label="Close detail sidebar"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dimmed)",
              cursor: "pointer",
              fontSize: "var(--font-size-base)",
              fontFamily: "var(--font-mono)",
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-dimmed)",
            fontSize: "var(--font-size-sm)",
            fontFamily: "var(--font-ui)",
            padding: 24,
            textAlign: "center",
          }}
        >
          Click a row to view its details
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="record-detail-sidebar"
      style={{
        width,
        background: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "var(--font-size-sm)",
            fontFamily: "var(--font-ui)",
            color: "var(--text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Record Detail
        </span>
        <button
          type="button"
          onClick={() => setDetailOpen(false)}
          aria-label="Close detail sidebar"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-dimmed)",
            cursor: "pointer",
            fontSize: "var(--font-size-base)",
            fontFamily: "var(--font-mono)",
            padding: "0 4px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Navigation + view mode */}
      <div
        style={{
          padding: "6px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={handlePrev}
          disabled={selectedRowIndex <= 0}
          aria-label="Previous record"
          style={{
            background: "none",
            border: "1px solid var(--border-strong)",
            color: selectedRowIndex > 0 ? "var(--text-primary)" : "var(--text-dimmed)",
            cursor: selectedRowIndex > 0 ? "pointer" : "not-allowed",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            padding: "2px 8px",
          }}
        >
          ◀
        </button>
        <span
          style={{
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-ui)",
            color: "var(--text-secondary)",
          }}
        >
          {selectedRowIndex + 1} / {result.rows.length}
        </span>
        <button
          type="button"
          onClick={handleNext}
          disabled={selectedRowIndex >= result.rows.length - 1}
          aria-label="Next record"
          style={{
            background: "none",
            border: "1px solid var(--border-strong)",
            color: selectedRowIndex < result.rows.length - 1 ? "var(--text-primary)" : "var(--text-dimmed)",
            cursor: selectedRowIndex < result.rows.length - 1 ? "pointer" : "not-allowed",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            padding: "2px 8px",
          }}
        >
          ▶
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            aria-label="Table view"
            style={{
              background: viewMode === "table" ? "var(--accent-bg)" : "none",
              border: "1px solid var(--border-strong)",
              color: viewMode === "table" ? "var(--accent)" : "var(--text-dimmed)",
              cursor: "pointer",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
              padding: "2px 8px",
            }}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => setViewMode("json")}
            aria-label="JSON view"
            style={{
              background: viewMode === "json" ? "var(--accent-bg)" : "none",
              border: "1px solid var(--border-strong)",
              color: viewMode === "json" ? "var(--accent)" : "var(--text-dimmed)",
              cursor: "pointer",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
              padding: "2px 8px",
            }}
          >
            JSON
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: "6px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search fields..."
          aria-label="Search fields"
          style={{
            width: "100%",
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            padding: "4px 8px",
          }}
        />
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: viewMode === "json" ? "12px 14px" : 0,
        }}
      >
        {viewMode === "table" ? (
          /* Table view: key-value pairs */
          <div>
            {filteredFields.map((field) => (
              <div
                key={field.name}
                style={{
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: "var(--font-size-xs)",
                      fontFamily: "var(--font-ui)",
                      color: "var(--text-dimmed)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {field.name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        fontSize: "10px",
                        fontFamily: "var(--font-ui)",
                        color: "var(--text-dimmed)",
                        opacity: 0.6,
                      }}
                    >
                      {typeBadge(field.value)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyField(field.value)}
                      aria-label={`Copy ${field.name}`}
                      title="Copy value"
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-dimmed)",
                        cursor: "pointer",
                        fontSize: "var(--font-size-xs)",
                        padding: "0 2px",
                        opacity: 0.6,
                      }}
                    >
                      ⧉
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "var(--font-size-sm)",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-primary)",
                    lineHeight: "20px",
                  }}
                >
                  <FieldValue value={field.value} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* JSON view: full record as formatted JSON */
          <div
            style={{
              fontSize: "var(--font-size-sm)",
              fontFamily: "var(--font-mono)",
              lineHeight: "22px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <JsonValue value={rowAsJson} depth={0} />
          </div>
        )}
      </div>

      {/* Footer: copy full record */}
      <div
        style={{
          padding: "6px 14px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => void handleCopyRecord()}
          aria-label="Copy full record as JSON"
          style={{
            background: "none",
            border: "1px solid var(--border-strong)",
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-ui)",
            padding: "3px 10px",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Copy JSON
        </button>
      </div>
    </div>
  );
}
