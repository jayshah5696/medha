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

export interface HistoryEntry {
  id: string;
  filename: string;
  timestamp: string;
  preview: string;
  duration_ms: number;
  row_count: number;
  source?: string;       // "user" | "agent"
  thread_slug?: string;  // chat thread slug (for agent queries)
}

export interface ChatThreadSummary {
  slug: string;
  created_at: string;
  model: string;
  message_count: number;
  preview: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatThread {
  slug: string;
  created_at: string;
  model: string;
  agent_profile: string;
  active_files: string[];
  messages: ChatMessage[];
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

export async function exportQuery(
  query: string,
  format: "csv" | "parquet"
): Promise<void> {
  const res = await fetch("/api/db/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, format }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Export error ${res.status}: ${body}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `export.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

// History API

export async function getHistory(): Promise<HistoryEntry[]> {
  return fetchJSON<HistoryEntry[]>("/api/history");
}

export async function getHistoryEntry(id: string): Promise<string> {
  const data = await fetchJSON<{ sql: string }>(`/api/history/${id}`);
  return data.sql;
}

export async function clearHistory(): Promise<void> {
  await fetchJSON("/api/history", { method: "DELETE" });
}

// Settings API

export async function getSettings(): Promise<Record<string, string>> {
  return fetchJSON("/api/settings");
}

export async function saveSettings(
  settings: Record<string, string>
): Promise<{ ok: boolean }> {
  return fetchJSON("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

// Chats API

export async function getChats(): Promise<ChatThreadSummary[]> {
  return fetchJSON<ChatThreadSummary[]>("/api/chats");
}

export async function getChat(slug: string): Promise<ChatThread> {
  return fetchJSON<ChatThread>(`/api/chats/${encodeURIComponent(slug)}`);
}

export async function deleteChat(slug: string): Promise<void> {
  await fetchJSON(`/api/chats/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
}

// Directory browsing API

export interface DirEntry {
  name: string;
  is_dir: boolean;
}

export interface BrowseResult {
  current: string;
  parent: string | null;
  entries: DirEntry[];
}

export async function browseDirectory(path: string = ""): Promise<BrowseResult> {
  return fetchJSON("/api/workspace/browse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

// SSE event stream for file change notifications

export function openEventStream(
  onFileChanged: (path: string) => void
): EventSource {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      if (event.type === "file_changed") {
        onFileChanged(event.path);
      }
    } catch {
      // skip malformed events
    }
  };
  return es;
}
