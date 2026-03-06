import { useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import type { QueryResult } from "../lib/api";

interface ResultGridProps {
  result: QueryResult | null;
  isQuerying: boolean;
}

function formatRowCount(n: number): string {
  return n.toLocaleString();
}

export default function ResultGrid({ result, isQuerying }: ResultGridProps) {
  if (isQuerying) {
    return (
      <div
        style={{
          maxHeight: "40vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dimmed)",
          fontSize: 16,
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
          maxHeight: "40vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dimmed)",
          fontSize: 16,
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
          maxHeight: "40vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#333",
          fontSize: 16,
          padding: 24,
          background: "var(--bg-primary)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <div>Query returned 0 rows.</div>
        <div
          style={{
            marginTop: 4,
            fontSize: 14,
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
          return String(val);
        },
      })
    );
  }, [result.columns]);

  return <ResultTable result={result} columns={columns} />;
}

function ResultTable({
  result,
  columns,
}: {
  result: QueryResult;
  columns: ReturnType<ReturnType<typeof createColumnHelper<unknown[]>>["accessor"]>[];
}) {
  const table = useReactTable({
    data: result.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div
      style={{
        maxHeight: "40vh",
        overflow: "auto",
        background: "var(--bg-primary)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 15,
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
                      fontSize: 14,
                      position: "sticky",
                      top: 0,
                      background: "var(--bg-secondary)",
                      whiteSpace: "nowrap",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      fontFamily: "var(--font-ui)",
                      height: "var(--row-height)",
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
          <tbody>
            {table.getRowModel().rows.map((row, rowIdx) => (
              <tr
                key={row.id}
                style={{
                  background: rowIdx % 2 === 0 ? "var(--bg-primary)" : "var(--bg-row-alt)",
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
                      height: "var(--row-height)",
                      lineHeight: "var(--row-height)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div
        style={{
          padding: "0 14px",
          fontSize: 14,
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
              fontSize: 14,
              letterSpacing: "0.04em",
            }}
          >
            TRUNCATED
          </span>
        )}
      </div>
    </div>
  );
}
