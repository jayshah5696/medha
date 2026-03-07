import { useMemo, useState, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import type { QueryResult } from "../lib/api";
import { useStore } from "../store";

interface ResultGridProps {
  result: QueryResult | null;
  isQuerying: boolean;
  height?: number;
}

function formatRowCount(n: number): string {
  return n.toLocaleString();
}

export default function ResultGrid({ result, isQuerying, height }: ResultGridProps) {
  // FEAT-1: use explicit height if provided, otherwise fall back to maxHeight
  const paneStyle: React.CSSProperties = height
    ? { height, minHeight: 100 }
    : { maxHeight: "40vh" };

  if (isQuerying) {
    return (
      <div
        style={{
          ...paneStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dimmed)",
          fontSize: 'var(--font-size-lg)',
          padding: 24,
          background: "var(--bg-primary)",
          fontFamily: "var(--font-ui)",
        }}
      >
        running query...
      </div>
    );
  }

  if (!result) {
    return (
      <div
        style={{
          ...paneStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dimmed)",
          fontSize: 'var(--font-size-lg)',
          padding: 24,
          background: "var(--bg-primary)",
          fontFamily: "var(--font-ui)",
        }}
      >
        Cmd+Enter to run
      </div>
    );
  }

  if (result.row_count === 0 || result.rows.length === 0) {
    return (
      <div
        style={{
          ...paneStyle,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#333",
          fontSize: 'var(--font-size-lg)',
          padding: 24,
          background: "var(--bg-primary)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <div>Query returned 0 rows.</div>
        <div
          style={{
            marginTop: 4,
            fontSize: 'var(--font-size-base)',
            color: "var(--text-dimmed)",
            fontFamily: "var(--font-ui)",
          }}
        >
          {result.duration_ms}ms
        </div>
      </div>
    );
  }

  // BUG-13: Memoize column definitions so TanStack Table doesn't
  // rebuild the entire table model on every render.
  const columns = useMemo(() => {
    const helper = createColumnHelper<unknown[]>();
    return result.columns.map((col, idx) =>
      helper.accessor((row) => row[idx], {
        id: col,
        header: col,
        cell: (info) => {
          const val = info.getValue();
          if (val === null) return <span style={{ color: "var(--text-dimmed)", fontStyle: "italic" }}>null</span>;
          if (typeof val === "object") {
            const json = JSON.stringify(val);
            const display = json.length > 120 ? json.slice(0, 120) + "\u2026" : json;
            return (
              <span
                style={{ color: "var(--text-secondary)", fontSize: "var(--font-size-xs)" }}
                title={json}
              >
                {display}
              </span>
            );
          }
          if (typeof val === "boolean") return String(val);
          return String(val);
        },
      })
    );
  }, [result.columns]);

  return <ResultTable result={result} columns={columns} height={height} />;
}

// Fixed row height in pixels — must match CSS var(--row-height)
const ROW_HEIGHT = 34;

function ResultTable({
  result,
  columns,
  height,
}: {
  result: QueryResult;
  columns: ReturnType<ReturnType<typeof createColumnHelper<unknown[]>>["accessor"]>[];
  height?: number;
}) {
  const editorContent = useStore((s) => s.editorContent);
  const [exporting, setExporting] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleExport = async (format: "csv" | "parquet") => {
    setExporting(format);
    try {
      const { exportQuery } = await import("../lib/api");
      await exportQuery(editorContent, format);
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setExporting(null);
    }
  };
  const table = useReactTable({
    data: result.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // FEAT-1: use explicit height if provided
  const containerStyle: React.CSSProperties = height
    ? { height, overflow: "hidden", background: "var(--bg-primary)", display: "flex", flexDirection: "column" }
    : { maxHeight: "40vh", overflow: "hidden", background: "var(--bg-primary)", display: "flex", flexDirection: "column" };

  return (
    <div style={containerStyle}>

      {/* Scrollable table area */}
      <div
        ref={scrollContainerRef}
        data-testid="virtual-scroll-container"
        style={{ flex: 1, overflow: "auto" }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 'var(--font-size-md)',
            fontFamily: "var(--font-mono)",
          }}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{
                      padding: "6px 14px",
                      textAlign: "left",
                      borderBottom: "1px solid var(--border-strong)",
                      color: "var(--text-dimmed)",
                      fontWeight: 500,
                      fontSize: 'var(--font-size-base)',
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                      background: "var(--bg-secondary)",
                      whiteSpace: "nowrap",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      fontFamily: "var(--font-ui)",
                      height: ROW_HEIGHT,
                    }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              display: "block",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <tr
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: "flex",
                    background: virtualRow.index % 2 === 0 ? "var(--bg-primary)" : "var(--bg-row-alt)",
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: "0 10px",
                        whiteSpace: "nowrap",
                        maxWidth: 300,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        height: ROW_HEIGHT,
                        lineHeight: `${ROW_HEIGHT}px`,
                        color: "var(--text-primary)",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div
        style={{
          padding: "0 14px",
          fontSize: 'var(--font-size-base)',
          color: "var(--text-dimmed)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderTop: "1px solid var(--border)",
          background: "var(--bg-secondary)",
          height: 30,
          minHeight: 30,
          fontFamily: "var(--font-ui)",
          flexShrink: 0,
        }}
      >
        <span>{formatRowCount(result.row_count)} rows</span>
        <span style={{ color: "var(--text-dimmed)" }}>{"\u00B7"}</span>
        <span>{result.duration_ms}ms</span>
        {result.truncated && (
          <span
            style={{
              color: "var(--accent)",
              fontWeight: 500,
              fontSize: 'var(--font-size-base)',
              letterSpacing: "0.04em",
            }}
          >
            TRUNCATED
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button
            onClick={() => handleExport("csv")}
            disabled={!!exporting}
            style={{
              background: "none",
              border: "1px solid var(--border-strong)",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-ui)",
              padding: "2px 8px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {exporting === "csv" ? "..." : "CSV"}
          </button>
          <button
            onClick={() => handleExport("parquet")}
            disabled={!!exporting}
            style={{
              background: "none",
              border: "1px solid var(--border-strong)",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-ui)",
              padding: "2px 8px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {exporting === "parquet" ? "..." : "Parquet"}
          </button>
        </span>
      </div>
    </div>
  );
}
