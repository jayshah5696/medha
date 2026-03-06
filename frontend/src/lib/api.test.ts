import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after stubbing fetch
import { getFiles, runQuery, getHistory, getChats, browseDirectory } from "./api";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("api", () => {
  it("getFiles returns FileInfo array shape", async () => {
    const mockFiles = [
      { name: "test.csv", path: "/test.csv", size_bytes: 1024, extension: ".csv" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockFiles),
    });
    const result = await getFiles();
    expect(result).toEqual(mockFiles);
    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("size_bytes");
  });

  it("runQuery sends correct payload", async () => {
    const mockResult = {
      columns: ["id"],
      rows: [[1]],
      truncated: false,
      row_count: 1,
      duration_ms: 5,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });
    const result = await runQuery("SELECT 1", "test-id");
    expect(mockFetch).toHaveBeenCalledWith("/api/db/query", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"query":"SELECT 1"'),
    }));
    expect(result.columns).toEqual(["id"]);
  });

  it("getHistory returns HistoryEntry array", async () => {
    const mockHistory = [
      { id: "2026-03-05/test.sql", filename: "test.sql", timestamp: "2026-03-05 12:00:00", preview: "SELECT 1", duration_ms: 5, row_count: 1 },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockHistory),
    });
    const result = await getHistory();
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("preview");
  });

  it("getChats returns ChatThread array", async () => {
    const mockChats = [
      { slug: "test-thread", created_at: "2026-03-05T12:00:00Z", model: "openai/gpt-4o-mini", message_count: 2, preview: "Hello" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockChats),
    });
    const result = await getChats();
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("slug");
    expect(result[0]).toHaveProperty("message_count");
  });

  it("browseDirectory sends correct payload and returns BrowseResult", async () => {
    const mockBrowse = {
      current: "/Users/test",
      parent: "/Users",
      entries: [
        { name: "Documents", is_dir: true },
        { name: "data.csv", is_dir: false },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockBrowse),
    });
    const result = await browseDirectory("/Users/test");
    expect(mockFetch).toHaveBeenCalledWith("/api/workspace/browse", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ path: "/Users/test" }),
    }));
    expect(result.current).toBe("/Users/test");
    expect(result.parent).toBe("/Users");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toHaveProperty("is_dir", true);
  });

  it("browseDirectory defaults to empty path", async () => {
    const mockBrowse = {
      current: "/Users/test",
      parent: "/Users",
      entries: [],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockBrowse),
    });
    await browseDirectory();
    expect(mockFetch).toHaveBeenCalledWith("/api/workspace/browse", expect.objectContaining({
      body: JSON.stringify({ path: "" }),
    }));
  });
});
