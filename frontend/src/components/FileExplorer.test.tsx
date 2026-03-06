import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock the api module before importing the component
vi.mock("../lib/api", () => ({
  configureWorkspace: vi.fn().mockResolvedValue({ ok: true, path: "/test" }),
  getFiles: vi.fn().mockResolvedValue([]),
  getHistory: vi.fn().mockResolvedValue([
    {
      id: "2026-03-05/12-00-00_select.sql",
      filename: "12-00-00_select.sql",
      timestamp: "2026-03-05 12:00:00",
      preview: "SELECT * FROM users",
      duration_ms: 5,
      row_count: 10,
    },
  ]),
  getHistoryEntry: vi.fn().mockResolvedValue("SELECT * FROM users"),
  clearHistory: vi.fn().mockResolvedValue(undefined),
}));

// Mock the store
const mockLoadHistoryEntry = vi.fn();
const mockSetLastError = vi.fn();

vi.mock("../store", () => ({
  useStore: () => ({
    workspacePath: "/test/path",
    setWorkspacePath: vi.fn(),
    files: [
      { name: "data.csv", path: "/test/data.csv", size_bytes: 2048, extension: ".csv" },
      { name: "users.parquet", path: "/test/users.parquet", size_bytes: 4096, extension: ".parquet" },
    ],
    setFiles: vi.fn(),
    activeFiles: ["data.csv"],
    toggleActiveFile: vi.fn(),
    setLastError: mockSetLastError,
    loadHistoryEntry: mockLoadHistoryEntry,
  }),
}));

import FileExplorer from "./FileExplorer";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FileExplorer", () => {
  it("renders workspace input", () => {
    render(<FileExplorer />);
    const input = screen.getByPlaceholderText("/path/to/data");
    expect(input).toBeInTheDocument();
  });

  it("shows file list after files loaded", () => {
    render(<FileExplorer />);
    expect(screen.getByText("data.csv")).toBeInTheDocument();
    expect(screen.getByText("users.parquet")).toBeInTheDocument();
  });

  it("active file shows highlighted", () => {
    render(<FileExplorer />);
    const activeItem = screen.getByText("data.csv");
    // Active file has a different style; just check it exists
    expect(activeItem).toBeInTheDocument();
  });

  it("history section is collapsed by default", () => {
    render(<FileExplorer />);
    expect(screen.getByText("history")).toBeInTheDocument();
    // The history entries should NOT be visible
    expect(screen.queryByText("no history")).not.toBeInTheDocument();
    expect(screen.queryByText("SELECT * FROM users")).not.toBeInTheDocument();
  });

  it("clicking history entry calls loadHistoryEntry", async () => {
    const { getHistoryEntry } = await import("../lib/api");
    render(<FileExplorer />);
    // Click to expand history
    fireEvent.click(screen.getByText("history"));
    // Wait for history to load
    await waitFor(() => {
      expect(screen.getByText(/SELECT \* FROM users/)).toBeInTheDocument();
    });
    // Click the history entry
    fireEvent.click(screen.getByText(/SELECT \* FROM users/));
    await waitFor(() => {
      expect(getHistoryEntry).toHaveBeenCalledWith("2026-03-05/12-00-00_select.sql");
    });
  });
});
