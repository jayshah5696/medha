import { vi } from "vitest";

export const mockApi = {
  getFiles: vi.fn().mockResolvedValue([]),
  configureWorkspace: vi.fn().mockResolvedValue({ ok: true, path: "/test" }),
  getSchema: vi.fn().mockResolvedValue({ filename: "test.csv", columns: [] }),
  runQuery: vi.fn().mockResolvedValue({
    columns: ["id"],
    rows: [[1]],
    truncated: false,
    row_count: 1,
    duration_ms: 5,
  }),
  cancelQuery: vi.fn().mockResolvedValue({ ok: true, query_id: "test" }),
  inlineEdit: vi.fn().mockResolvedValue({ sql: "SELECT 1" }),
  getHistory: vi.fn().mockResolvedValue([]),
  getHistoryEntry: vi.fn().mockResolvedValue("SELECT 1"),
  clearHistory: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn().mockResolvedValue({}),
  saveSettings: vi.fn().mockResolvedValue({ ok: true }),
  getChats: vi.fn().mockResolvedValue([]),
  getChat: vi.fn().mockResolvedValue({ slug: "test", messages: [] }),
  deleteChat: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../lib/api", () => mockApi);
