// Typed fetch wrappers for Medha API

export interface FileInfo {
  name: string;
  path: string;
  size_bytes: number;
  extension: string;
}

export interface SchemaColumn {
  name: string;
  type: string;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  row_count: number;
  duration_ms: number;
}

export interface InlineEditResult {
  sql: string;
}

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function getFiles(): Promise<FileInfo[]> {
  return fetchJSON<FileInfo[]>("/api/workspace/files");
}

export async function configureWorkspace(
  path: string
): Promise<{ ok: boolean; path: string }> {
  return fetchJSON("/api/workspace/configure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export async function getSchema(
  filename: string
): Promise<{ filename: string; columns: SchemaColumn[] }> {
  return fetchJSON(`/api/db/schema/${encodeURIComponent(filename)}`);
}

export async function runQuery(
  query: string,
  queryId: string,
  format: string = "json"
): Promise<QueryResult> {
  return fetchJSON("/api/db/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, query_id: queryId, format }),
  });
}

export async function cancelQuery(
  queryId: string
): Promise<{ ok: boolean; query_id: string }> {
  return fetchJSON(`/api/db/query/${encodeURIComponent(queryId)}`, {
    method: "DELETE",
  });
}

export async function inlineEdit(
  instruction: string,
  selectedSql: string,
  activeFiles: string[],
  model?: string
): Promise<InlineEditResult> {
  return fetchJSON("/api/ai/inline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruction,
      selected_sql: selectedSql,
      active_files: activeFiles,
      model: model || "gpt-4o-mini",
    }),
  });
}
