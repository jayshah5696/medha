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
  runQuery: vi.fn().mockResolvedValue({ columns: [], rows: [], row_count: 0 }),
}));

// Mock the store — useStore() is called without a selector (destructured)
const mockStore = {
  workspacePath: "",
  setWorkspacePath: vi.fn(),
  files: [] as Array<{ name: string; path: string; size_bytes: number; extension: string }>,
  setFiles: vi.fn(),
  activeFiles: [] as string[],
  toggleActiveFile: vi.fn(),
  clearActiveFiles: vi.fn(),
  setLastError: vi.fn(),
  loadHistoryEntry: vi.fn(),
  historyVersion: 0,
  bumpHistoryVersion: vi.fn(),
  editorContent: "",
  setEditorContent: vi.fn(),
  setQueryResult: vi.fn(),
  setIsQuerying: vi.fn(),
  fileFilter: "",
  setFileFilter: vi.fn(),
  theme: "dark",
};
vi.mock("../store", () => ({
  useStore: vi.fn((selector?: (s: typeof mockStore) => unknown) =>
    selector ? selector(mockStore) : mockStore
  ),
}));

import FileExplorer from "./FileExplorer";

describe("FileExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure no Electron API in test environment
    delete (window as any).electronAPI;
  });

  it("renders workspace input in web mode", () => {
    render(<FileExplorer width={220} />);
    const input = screen.getByPlaceholderText("/path/to/data");
    expect(input).toBeInTheDocument();
  });

  it("calls configure when Open is clicked", async () => {
    const { configureWorkspace } = await import("../lib/api");
    render(<FileExplorer width={220} />);
    const input = screen.getByPlaceholderText("/path/to/data") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/tmp/test" } });
    fireEvent.click(screen.getByText("open"));
    await waitFor(() => {
      expect(configureWorkspace).toHaveBeenCalledWith("/tmp/test");
    });
  });

  it("loads history on section expand", async () => {
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

  it("renders browse button in web mode", () => {
    render(<FileExplorer width={220} />);
    const browseBtn = screen.getByText("browse...");
    expect(browseBtn).toBeInTheDocument();
  });

  it("clicking browse opens folder picker modal", async () => {
    const { browseDirectory } = await import("../lib/api");
    render(<FileExplorer width={220} />);
    fireEvent.click(screen.getByText("browse..."));
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

  it("clicking 'select this folder' auto-configures workspace", async () => {
    const { configureWorkspace } = await import("../lib/api");
    render(<FileExplorer width={220} />);
    fireEvent.click(screen.getByText("browse..."));
    await waitFor(() => {
      expect(screen.getByText("select folder")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("select this folder"));
    // Should auto-configure the workspace
    await waitFor(() => {
      expect(configureWorkspace).toHaveBeenCalledWith("/Users/test/data");
    });
    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText("select folder")).not.toBeInTheDocument();
    });
  });

  it("clicking cancel closes the browse modal", async () => {
    render(<FileExplorer width={220} />);
    fireEvent.click(screen.getByText("browse..."));
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
    fireEvent.click(screen.getByText("browse..."));
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
    fireEvent.click(screen.getByText("browse..."));
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

  // --- Electron mode tests ---

  it("shows choose folder button in Electron mode", () => {
    (window as any).electronAPI = { pickDirectory: vi.fn() };
    render(<FileExplorer width={220} />);
    expect(screen.getByText("choose folder")).toBeInTheDocument();
    // Should NOT show text input in Electron mode
    expect(screen.queryByPlaceholderText("/path/to/data")).not.toBeInTheDocument();
    delete (window as any).electronAPI;
  });

  it("does not show choose folder button in web mode", () => {
    delete (window as any).electronAPI;
    render(<FileExplorer width={220} />);
    expect(screen.queryByText("choose folder")).not.toBeInTheDocument();
    // Should show text input
    expect(screen.getByPlaceholderText("/path/to/data")).toBeInTheDocument();
  });
});
