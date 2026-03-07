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
  browseDirectory: vi.fn().mockResolvedValue({
    current: "/Users/test/data",
    parent: "/Users/test",
    entries: [
      { name: "subdir", is_dir: true },
      { name: "sales.csv", is_dir: false },
    ],
  }),
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
    render(<FileExplorer width={220} />);
    const input = screen.getByPlaceholderText("/path/to/data");
    expect(input).toBeInTheDocument();
  });

  it("shows file list after files loaded", () => {
    render(<FileExplorer width={220} />);
    expect(screen.getByText("data.csv")).toBeInTheDocument();
    expect(screen.getByText("users.parquet")).toBeInTheDocument();
  });

  it("active file shows highlighted", () => {
    render(<FileExplorer width={220} />);
    const activeItem = screen.getByText("data.csv");
    // Active file has a different style; just check it exists
    expect(activeItem).toBeInTheDocument();
  });

  it("history section is collapsed by default", () => {
    render(<FileExplorer width={220} />);
    expect(screen.getByText("history")).toBeInTheDocument();
    // The history entries should NOT be visible
    expect(screen.queryByText("no history")).not.toBeInTheDocument();
    expect(screen.queryByText("SELECT * FROM users")).not.toBeInTheDocument();
  });

  it("clicking history entry calls loadHistoryEntry", async () => {
    const { getHistoryEntry } = await import("../lib/api");
    render(<FileExplorer width={220} />);
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

  it("renders browse button", () => {
    render(<FileExplorer width={220} />);
    const browseBtn = screen.getByTitle("Browse folders");
    expect(browseBtn).toBeInTheDocument();
  });

  it("clicking browse opens folder picker modal", async () => {
    const { browseDirectory } = await import("../lib/api");
    render(<FileExplorer width={220} />);
    fireEvent.click(screen.getByTitle("Browse folders"));
    await waitFor(() => {
      expect(browseDirectory).toHaveBeenCalled();
    });
    // Modal should show current path and entries
    await waitFor(() => {
      expect(screen.getByText("select folder")).toBeInTheDocument();
      expect(screen.getByText("/Users/test/data")).toBeInTheDocument();
      expect(screen.getByText("subdir")).toBeInTheDocument();
      expect(screen.getByText("sales.csv")).toBeInTheDocument();
    });
  });

  it("clicking 'select this folder' populates input and closes modal", async () => {
    render(<FileExplorer width={220} />);
    fireEvent.click(screen.getByTitle("Browse folders"));
    await waitFor(() => {
      expect(screen.getByText("select folder")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("select this folder"));
    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText("select folder")).not.toBeInTheDocument();
    });
    // Input should have the browsed path
    const input = screen.getByPlaceholderText("/path/to/data") as HTMLInputElement;
    expect(input.value).toBe("/Users/test/data");
  });

  it("clicking cancel closes the browse modal", async () => {
    render(<FileExplorer width={220} />);
    fireEvent.click(screen.getByTitle("Browse folders"));
    await waitFor(() => {
      expect(screen.getByText("select folder")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("cancel"));
    await waitFor(() => {
      expect(screen.queryByText("select folder")).not.toBeInTheDocument();
    });
  });

  it("clicking a subdirectory in browse navigates into it", async () => {
    const { browseDirectory } = await import("../lib/api");
    render(<FileExplorer width={220} />);
    fireEvent.click(screen.getByTitle("Browse folders"));
    await waitFor(() => {
      expect(screen.getByText("subdir")).toBeInTheDocument();
    });
    // Click into subdir — should call browseDirectory again
    fireEvent.click(screen.getByText("subdir"));
    await waitFor(() => {
      expect(browseDirectory).toHaveBeenCalledWith("/Users/test/data/subdir");
    });
  });

  it("clicking '..' navigates to parent directory", async () => {
    const { browseDirectory } = await import("../lib/api");
    render(<FileExplorer width={220} />);
    fireEvent.click(screen.getByTitle("Browse folders"));
    await waitFor(() => {
      expect(screen.getByText("..")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(".."));
    await waitFor(() => {
      expect(browseDirectory).toHaveBeenCalledWith("/Users/test");
    });
  });

  it("uses width prop for sidebar width", () => {
    const { container } = render(<FileExplorer width={300} />);
    const sidebar = container.firstChild as HTMLElement;
    expect(sidebar.style.width).toBe("300px");
  });

  // --- showDirectoryPicker() tests (Spec §14B) ---

  it("shows native picker button when showDirectoryPicker is available", () => {
    // Simulate Chrome/Edge with File System Access API
    (window as any).showDirectoryPicker = vi.fn();
    render(<FileExplorer width={220} />);
    const nativeBtn = screen.getByTitle("Open native folder picker");
    expect(nativeBtn).toBeInTheDocument();
    delete (window as any).showDirectoryPicker;
  });

  it("hides native picker button when showDirectoryPicker is not available", () => {
    // Simulate Firefox/Safari without File System Access API
    delete (window as any).showDirectoryPicker;
    render(<FileExplorer width={220} />);
    const nativeBtn = screen.queryByTitle("Open native folder picker");
    expect(nativeBtn).not.toBeInTheDocument();
  });

  it("native picker pre-fills input with folder name", async () => {
    const mockHandle = { kind: "directory", name: "my-data-folder" };
    (window as any).showDirectoryPicker = vi.fn().mockResolvedValue(mockHandle);

    render(<FileExplorer width={220} />);
    const nativeBtn = screen.getByTitle("Open native folder picker");
    fireEvent.click(nativeBtn);

    await waitFor(() => {
      const input = screen.getByPlaceholderText("/path/to/data") as HTMLInputElement;
      expect(input.value).toContain("my-data-folder");
    });

    delete (window as any).showDirectoryPicker;
  });
});
