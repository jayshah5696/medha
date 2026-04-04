import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import type { QueryResult } from "../lib/api";
import { useStore } from "../store";

interface ResultGridProps {
  result: QueryResult | null;
  isQuerying: boolean;
  height?: number;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
}

function formatRowCount(n: number): string {
  return n.toLocaleString();
}

function serializeCellValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function ResultGrid({ result, isQuerying, height, onLoadMore, isLoadingMore }: ResultGridProps) {
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
          color: "var(--text-dimmed)",
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

  return <ResultTable result={result} height={height} onLoadMore={onLoadMore} isLoadingMore={isLoadingMore} />;
}

// Fixed row height in pixels — must match CSS var(--row-height)
const ROW_HEIGHT = 34;

function ResultTable({
  result,
  height,
  onLoadMore,
  isLoadingMore,
}: {
  result: QueryResult;
  height?: number;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
}) {
  const editorContent = useStore((s) => s.editorContent);
  const addToast = useStore((s) => s.addToast);
  const [exporting, setExporting] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const copyCellValue = useCallback(async (value: unknown) => {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    const serialized = serializeCellValue(value);
    await navigator.clipboard.writeText(serialized);
    addToast(`Copied ${serialized.slice(0, 32)}`);
  }, [addToast]);

  const columns = useMemo(() => {
    const helper = createColumnHelper<unknown[]>();
    return result.columns.map((col, idx) =>
      helper.accessor((row) => row[idx], {
        id: col,
        sortDescFirst: false,
        header: ({ column }) => {
          const sortState = column.getIsSorted();
          const sortSuffix = sortState === "asc" ? " ↑" : sortState === "desc" ? " ↓" : "";

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 0" }}>
              <button
                type="button"
                onClick={column.getToggleSortingHandler()}
                aria-label={`Sort by ${col}`}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  font: "inherit",
                  padding: 0,
                  textAlign: "left",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {col}{sortSuffix}
              </button>
              <input
                value={(column.getFilterValue() as string) ?? ""}
                onChange={(event) => column.setFilterValue(event.target.value)}
                placeholder={`filter ${col}`}
                style={{
                  width: "100%",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-mono)",
                  padding: "4px 6px",
                }}
              />
            </div>
          );
        },
        cell: (info) => {
          const val = info.getValue();
          const serialized = serializeCellValue(val);
          const display = serialized.length > 120 ? `${serialized.slice(0, 120)}\u2026` : serialized;
          const isObject = typeof val === "object" && val !== null;

          return (
            <button
              type="button"
              onClick={() => {
                void copyCellValue(val);
              }}
              aria-label={`Copy value ${display}`}
              style={{
                width: "100%",
                height: "100%",
                background: "none",
                border: "none",
                color: val === null ? "var(--text-dimmed)" : isObject ? "var(--text-secondary)" : "inherit",
                cursor: "pointer",
                font: "inherit",
                fontStyle: val === null ? "italic" : "normal",
                padding: 0,
                textAlign: "left",
              }}
              title={serialized}
            >
              {display}
            </button>
          );
        },
        filterFn: (row, columnId, filterValue) => {
          const current = serializeCellValue(row.getValue(columnId)).toLowerCase();
          return current.includes(String(filterValue).toLowerCase());
        },
      })
    );
  }, [copyCellValue, result.columns]);

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
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Infinite scroll: trigger onLoadMore when user scrolls near the bottom
  const handleScroll = useCallback(() => {
    if (!onLoadMore || isLoadingMore || !result.has_more) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Trigger load when within 5 rows of the bottom
    if (distanceFromBottom < ROW_HEIGHT * 5) {
      onLoadMore();
    }
  }, [onLoadMore, isLoadingMore, result.has_more]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // FEAT-1: use explicit height if provided
  const containerStyle: React.CSSProperties = height
    ? { height, overflow: "hidden", background: "var(--bg-primary)", display: "flex", flexDirection: "column" }
    : { maxHeight: "40vh", overflow: "hidden", background: "var(--bg-primary)", display: "flex", flexDirection: "column" };

  const colCount = table.getAllColumns().length;
  const { gridColumns, minWidth } = useMemo(() => ({
    gridColumns: `repeat(${colCount}, minmax(120px, 1fr))`,
    minWidth: colCount * 120,
  }), [colCount]);

  return (
    <div style={containerStyle}>

      {/* Outer scroll container: horizontal scroll shared by header + body */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>

        {/* Sticky header — inside the horizontal scroll container so it scrolls horizontally with the body */}
        <div
          role="table"
          style={{
            fontSize: 'var(--font-size-md)',
            fontFamily: "var(--font-mono)",
            position: "sticky",
            top: 0,
            zIndex: 1,
            minWidth,
          }}
        >
          <div role="rowgroup">
            {table.getHeaderGroups().map((hg) => (
              <div
                key={hg.id}
                role="row"
                style={{
                  display: "grid",
                  gridTemplateColumns: gridColumns,
                  borderBottom: "1px solid var(--border-strong)",
                  background: "var(--bg-secondary)",
                }}
              >
                {hg.headers.map((header) => (
                  <div
                    key={header.id}
                    role="columnheader"
                    style={{
                      padding: "6px 14px",
                      textAlign: "left",
                      color: "var(--text-dimmed)",
                      fontWeight: 500,
                      fontSize: 'var(--font-size-base)',
                      fontFamily: "var(--font-ui)",
                      overflow: "hidden",
                    }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable virtualized body — only vertical scroll here */}
        <div
          ref={scrollContainerRef}
          data-testid="virtual-scroll-container"
          style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}
        >
          <div
            role="rowgroup"
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              fontSize: 'var(--font-size-md)',
              fontFamily: "var(--font-mono)",
              minWidth,
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <div
                  key={row.id}
                  role="row"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: "grid",
                    gridTemplateColumns: gridColumns,
                    background: virtualRow.index % 2 === 0 ? "var(--bg-primary)" : "var(--bg-row-alt)",
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div
                      key={cell.id}
                      role="cell"
                      style={{
                        padding: "0 10px",
                        overflow: "hidden",
                        height: ROW_HEIGHT,
                        lineHeight: `${ROW_HEIGHT}px`,
                        color: "var(--text-primary)",
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

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
        <span>
          {result.total_row_count != null
            ? `${formatRowCount(result.rows.length)} / ${formatRowCount(result.total_row_count)} rows`
            : `${formatRowCount(result.row_count)} rows`}
        </span>
        <span style={{ color: "var(--text-dimmed)" }}>{"\u00B7"}</span>
        <span>{result.duration_ms}ms</span>
        {isLoadingMore && (
          <span style={{ color: "var(--text-dimmed)", fontSize: "var(--font-size-xs)" }}>
            loading...
          </span>
        )}
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
