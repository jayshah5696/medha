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

export default function ResultGrid({ result, isQuerying }: ResultGridProps) {
  if (isQuerying) {
    return (
      <div
        style={{
          maxHeight: "40vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-secondary)",
          fontSize: 14,
          padding: 24,
          background: "var(--bg-secondary)",
        }}
      >
        Running query...
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
          color: "var(--text-secondary)",
          fontSize: 13,
          padding: 24,
          background: "var(--bg-secondary)",
        }}
      >
        Run a query with Cmd+Enter to see results here.
      </div>
    );
  }

  const columnHelper = createColumnHelper<unknown[]>();

  const columns = result.columns.map((col, idx) =>
    columnHelper.accessor((row) => row[idx], {
      id: col,
      header: col,
      cell: (info) => {
        const val = info.getValue();
        if (val === null) return <span style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>null</span>;
        return String(val);
      },
    })
  );

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
        background: "var(--bg-secondary)",
      }}
    >
      <div
        style={{
          padding: "6px 12px",
          fontSize: 12,
          color: "var(--text-secondary)",
          display: "flex",
          gap: 16,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-tertiary)",
        }}
      >
        <span>{result.row_count} rows</span>
        <span>{result.duration_ms}ms</span>
        {result.truncated && (
          <span
            style={{
              background: "var(--warning)",
              color: "#1e1e2e",
              padding: "1px 6px",
              borderRadius: 3,
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            TRUNCATED
          </span>
        )}
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  style={{
                    padding: "6px 10px",
                    textAlign: "left",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--accent)",
                    fontWeight: 600,
                    fontSize: 12,
                    position: "sticky",
                    top: 0,
                    background: "var(--bg-secondary)",
                    whiteSpace: "nowrap",
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
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              style={{
                borderBottom: "1px solid var(--border)",
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  style={{
                    padding: "4px 10px",
                    whiteSpace: "nowrap",
                    maxWidth: 300,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
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
  );
}
