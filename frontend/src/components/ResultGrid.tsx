import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import type { QueryResult } from "../lib/api";
import { useStore } from "../store";
import "./ResultGrid.css";

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

export default function ResultGrid({ result, isQuerying, height, onLoadMore, isLoadingMore }: ResultGridProps) {
  // FEAT-1: use explicit height if provided, otherwise fall back to maxHeight
  const paneStyle: React.CSSProperties = height
    ? { height, minHeight: 100 }
    : { maxHeight: "40vh" };

  if (isQuerying) {
    return (
      <div className="rg-placeholder" style={paneStyle}>
        running query...
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rg-placeholder" style={paneStyle}>
        Cmd+Enter to run
      </div>
    );
  }

  if (result.row_count === 0 || result.rows.length === 0) {
    return (
      <div className="rg-placeholder-mono" style={paneStyle}>
        <div>Query returned 0 rows.</div>
        <div className="rg-zero-duration">
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
          if (val === null) return <span className="rg-cell-null">null</span>;
          if (typeof val === "object") {
            const json = JSON.stringify(val);
            const display = json.length > 120 ? json.slice(0, 120) + "\u2026" : json;
            return (
              <span className="rg-cell-json" title={json}>
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

  return <ResultTable result={result} columns={columns} height={height} onLoadMore={onLoadMore} isLoadingMore={isLoadingMore} />;
}

// Fixed row height in pixels — must match CSS var(--row-height)
const ROW_HEIGHT = 34;

function ResultTable({
  result,
  columns,
  height,
  onLoadMore,
  isLoadingMore,
}: {
  result: QueryResult;
  columns: ReturnType<ReturnType<typeof createColumnHelper<unknown[]>>["accessor"]>[];
  height?: number;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
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

  // FEAT-1: use explicit height if provided (dynamic — height vs maxHeight)
  const containerDynamicStyle: React.CSSProperties = height
    ? { height }
    : { maxHeight: "40vh" };

  // Build a CSS grid-template-columns value so header and body share
  // identical column sizing. Each column gets minmax(120px, 1fr).
  const colCount = table.getAllColumns().length;
  const gridColumns = `repeat(${colCount}, minmax(120px, 1fr))`;

  return (
    <div className="rg-container" style={containerDynamicStyle}>

      {/* Sticky header — outside the scroll container so it never scrolls away */}
      <div role="table" className="rg-table">
        <div role="rowgroup">
          {table.getHeaderGroups().map((hg) => (
            <div
              key={hg.id}
              role="row"
              className="rg-header-row"
              style={{ gridTemplateColumns: gridColumns }}
            >
              {hg.headers.map((header) => (
                <div
                  key={header.id}
                  role="columnheader"
                  className="rg-column-header"
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

      {/* Scrollable virtualized body */}
      <div
        ref={scrollContainerRef}
        data-testid="virtual-scroll-container"
        className="rg-scroll"
      >
        <div
          role="rowgroup"
          className="rg-body"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={row.id}
                role="row"
                className={`rg-row ${virtualRow.index % 2 === 0 ? "rg-row-even" : "rg-row-odd"}`}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  gridTemplateColumns: gridColumns,
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    role="cell"
                    className="rg-cell"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Status bar */}
      <div className="rg-status">
        <span>
          {result.total_row_count != null
            ? `${formatRowCount(result.rows.length)} / ${formatRowCount(result.total_row_count)} rows`
            : `${formatRowCount(result.row_count)} rows`}
        </span>
        <span className="rg-status-dot">{"\u00B7"}</span>
        <span>{result.duration_ms}ms</span>
        {isLoadingMore && (
          <span className="rg-status-loading">
            loading...
          </span>
        )}
        {result.truncated && (
          <span className="rg-status-truncated">
            TRUNCATED
          </span>
        )}
        <span className="rg-export-group">
          <button
            onClick={() => handleExport("csv")}
            disabled={!!exporting}
            className="rg-export-btn"
          >
            {exporting === "csv" ? "..." : "CSV"}
          </button>
          <button
            onClick={() => handleExport("parquet")}
            disabled={!!exporting}
            className="rg-export-btn"
          >
            {exporting === "parquet" ? "..." : "Parquet"}
          </button>
        </span>
      </div>
    </div>
  );
}
