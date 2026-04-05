import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ResultGrid from "./ResultGrid";
import { useStore } from "../store";

// ── jsdom layout mocking for @tanstack/react-virtual ──────────────
// jsdom has no layout engine. The virtualizer measures the scroll
// container via getBoundingClientRect, clientHeight, and ResizeObserver.
// We mock all three so it sees a 400px-tall viewport.
const MOCK_HEIGHT = 400;

function setupLayoutMocks() {
  let originalGetBCR: typeof Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.cb = cb; }
      observe(target: Element) {
        this.cb(
          [{ contentRect: { height: MOCK_HEIGHT, width: 800 }, target } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    });

    originalGetBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.getAttribute("data-testid") === "virtual-scroll-container") {
        return { top: 0, left: 0, bottom: MOCK_HEIGHT, right: 800, width: 800, height: MOCK_HEIGHT, x: 0, y: 0, toJSON: () => ({}) };
      }
      return originalGetBCR.call(this);
    };

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        if (this.getAttribute?.("data-testid") === "virtual-scroll-container") return MOCK_HEIGHT;
        return 0;
      },
    });

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        if (this.getAttribute?.("data-testid") === "virtual-scroll-container") return MOCK_HEIGHT;
        return 0;
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Element.prototype.getBoundingClientRect = originalGetBCR;
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true, get() { return 0; },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true, get() { return 0; },
    });
  });
}

describe("ResultGrid", () => {
  // Apply layout mocks to all tests since the virtualizer is used everywhere
  setupLayoutMocks();

  const baseResult = {
    columns: ["id", "name", "score"],
    rows: [
      [1, "Alice", 85.5],
      [2, "Bob", 92.0],
    ],
    truncated: false,
    row_count: 2,
    duration_ms: 42,
  };

  it("renders column headers from queryResult", () => {
    render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("score")).toBeInTheDocument();
  });

  it("renders row data", () => {
    render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("85.5")).toBeInTheDocument();
  });

  it("sorts rows when a column header is clicked", async () => {
    render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);

    fireEvent.click(screen.getByRole("button", { name: /sort by score/i }));

    await waitFor(() => {
      const rows = screen.getAllByRole("row");
      expect(rows[1]).toHaveTextContent("Alice");
      expect(rows[2]).toHaveTextContent("Bob");
    });

    fireEvent.click(screen.getByRole("button", { name: /sort by score/i }));

    await waitFor(() => {
      const rows = screen.getAllByRole("row");
      expect(rows[1]).toHaveTextContent("Bob");
      expect(rows[2]).toHaveTextContent("Alice");
    });
  });

  it("filters rows with the column filter input", async () => {
    render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);

    fireEvent.change(screen.getByPlaceholderText("filter name"), {
      target: { value: "Bob" },
    });

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    });
  });

  it("copies cell values to the clipboard when double-clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);

    fireEvent.doubleClick(screen.getByLabelText(/copy value alice/i));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Alice");
    });
  });

  it("shows truncation badge when truncated=true", () => {
    const truncatedResult = { ...baseResult, truncated: true };
    render(<ResultGrid result={truncatedResult} isQuerying={false} height={400} />);
    expect(screen.getByText("TRUNCATED")).toBeInTheDocument();
  });

  it("shows row count and duration", () => {
    render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);
    expect(screen.getByText("2 rows")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
  });

  it("shows loaded/total row count when pagination fields present", () => {
    const paginatedResult = {
      ...baseResult,
      total_row_count: 1000,
      has_more: true,
      offset: 0,
    };
    render(<ResultGrid result={paginatedResult} isQuerying={false} height={400} />);
    expect(screen.getByText("2 / 1,000 rows")).toBeInTheDocument();
  });

  it("no truncation badge when truncated=false", () => {
    render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);
    expect(screen.queryByText("TRUNCATED")).not.toBeInTheDocument();
  });

  // FEAT-1: height prop tests
  it("accepts height prop and renders with explicit height", () => {
    const { container } = render(
      <ResultGrid result={baseResult} isQuerying={false} height={300} />
    );
    // The outer div should use explicit height, not maxHeight
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv).toBeTruthy();
    expect(outerDiv.style.height).toBe("300px");
  });

  it("renders loading state with height prop", () => {
    const { container } = render(
      <ResultGrid result={null} isQuerying={true} height={200} />
    );
    expect(screen.getByText("running query...")).toBeInTheDocument();
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv.style.height).toBe("200px");
  });

  it("renders empty state with height prop", () => {
    render(
      <ResultGrid result={null} isQuerying={false} height={250} />
    );
    expect(screen.getByText("Cmd+Enter to run")).toBeInTheDocument();
  });

  // ── Phase 1: Virtualization tests ──────────────────────────────────

  describe("virtualization", () => {
    // Generate a large dataset: N rows x 3 columns
    function makeLargeResult(rowCount: number) {
      const rows = Array.from({ length: rowCount }, (_, i) => [
        i + 1,
        `Name-${i + 1}`,
        Math.round(Math.random() * 100 * 10) / 10,
      ]);
      return {
        columns: ["id", "name", "score"],
        rows,
        truncated: rowCount >= 10000,
        row_count: rowCount,
        duration_ms: 150,
      };
    }

    it("renders far fewer DOM rows than data rows for large datasets", () => {
      const largeResult = makeLargeResult(10000);
      const { container } = render(
        <ResultGrid result={largeResult} isQuerying={false} height={400} />
      );
      // With virtualization, the number of rendered row divs in the scroll body
      // should be far fewer than 10,000 (roughly viewport / row-height + overscan)
      const scrollContainer = container.querySelector('[data-testid="virtual-scroll-container"]');
      const bodyRows = scrollContainer!.querySelectorAll('[role="row"]');
      expect(bodyRows.length).toBeLessThan(200);
      expect(bodyRows.length).toBeGreaterThan(0);
    });

    it("still shows correct status bar info for large datasets", () => {
      const largeResult = makeLargeResult(10000);
      render(
        <ResultGrid result={largeResult} isQuerying={false} height={400} />
      );
      expect(screen.getByText("10,000 rows")).toBeInTheDocument();
      expect(screen.getByText("150ms")).toBeInTheDocument();
      expect(screen.getByText("TRUNCATED")).toBeInTheDocument();
    });

    it("renders the first visible rows correctly", () => {
      const largeResult = makeLargeResult(500);
      render(
        <ResultGrid result={largeResult} isQuerying={false} height={400} />
      );
      // First row data should be visible
      expect(screen.getByText("Name-1")).toBeInTheDocument();
    });

    it("uses a scrollable container for the table body", () => {
      const largeResult = makeLargeResult(1000);
      const { container } = render(
        <ResultGrid result={largeResult} isQuerying={false} height={400} />
      );
      // There should be a scrollable container with overflow auto
      const scrollContainer = container.querySelector('[data-testid="virtual-scroll-container"]');
      expect(scrollContainer).toBeTruthy();
    });

    it("small datasets still render all rows", () => {
      // 2 rows should all render (no virtualization penalty for small data)
      const { container } = render(
        <ResultGrid result={baseResult} isQuerying={false} height={400} />
      );
      const scrollContainer = container.querySelector('[data-testid="virtual-scroll-container"]');
      const bodyRows = scrollContainer!.querySelectorAll('[role="row"]');
      expect(bodyRows.length).toBe(2);
    });

    it("scroll body has a total height matching all rows for scroll spacing", () => {
      const largeResult = makeLargeResult(1000);
      const { container } = render(
        <ResultGrid result={largeResult} isQuerying={false} height={400} />
      );
      const scrollContainer = container.querySelector('[data-testid="virtual-scroll-container"]');
      const scrollBody = scrollContainer!.firstElementChild as HTMLElement;
      // 1000 rows * 34px = 34000px total height
      expect(scrollBody.style.height).toBe("34000px");
    });

    it("header and body rows use the same grid-template-columns", () => {
      const largeResult = makeLargeResult(100);
      const { container } = render(
        <ResultGrid result={largeResult} isQuerying={false} height={400} />
      );
      // Header row (outside scroll container)
      const headerRow = container.querySelector('[role="rowgroup"] [role="row"]') as HTMLElement;
      expect(headerRow).toBeTruthy();
      const headerGrid = headerRow.style.gridTemplateColumns;
      expect(headerGrid).toBeTruthy();

      // First body row (inside scroll container)
      const scrollContainer = container.querySelector('[data-testid="virtual-scroll-container"]');
      const bodyRow = scrollContainer!.querySelector('[role="row"]') as HTMLElement;
      expect(bodyRow).toBeTruthy();
      const bodyGrid = bodyRow.style.gridTemplateColumns;

      // They must be identical so columns align
      expect(bodyGrid).toBe(headerGrid);
    });

    it("each body row has the same number of cells as there are column headers", () => {
      const largeResult = makeLargeResult(50);
      const { container } = render(
        <ResultGrid result={largeResult} isQuerying={false} height={400} />
      );
      const headerCells = container.querySelectorAll('[role="columnheader"]');
      const scrollContainer = container.querySelector('[data-testid="virtual-scroll-container"]');
      const firstBodyRow = scrollContainer!.querySelector('[role="row"]') as HTMLElement;
      const bodyCells = firstBodyRow.querySelectorAll('[role="cell"]');

      expect(headerCells.length).toBe(4); // # + id, name, score
      expect(bodyCells.length).toBe(headerCells.length);
    });

    it("body cells are not truncated to single characters on wide data", () => {
      // Regression guard: columns must get enough width to show content,
      // not collapse into equal-width flex items showing "a..." for everything.
      const wideResult = {
        columns: ["id", "full_name", "email"],
        rows: [
          [1, "Alice Wonderland", "alice@example.com"],
          [2, "Bob Builder", "bob@example.com"],
        ],
        truncated: false,
        row_count: 2,
        duration_ms: 10,
      };
      render(
        <ResultGrid result={wideResult} isQuerying={false} height={400} />
      );
      // Full text should be present in the DOM (not truncated to "A...")
      expect(screen.getByText("Alice Wonderland")).toBeInTheDocument();
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });
  });

  // ── Row index column tests ───────────────────────────────────────

  describe("row index column", () => {
    it("renders a # column header", () => {
      render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);
      expect(screen.getByText("#")).toBeInTheDocument();
    });

    it("shows 1-based row numbers in # column", () => {
      const { container } = render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);
      // Each row should have a first cell with the row number
      const scrollContainer = container.querySelector('[data-testid="virtual-scroll-container"]');
      const rows = scrollContainer!.querySelectorAll('[role="row"]');
      // First cell of first row should be "1"
      const firstRowCells = rows[0].querySelectorAll('[role="cell"]');
      expect(firstRowCells[0].textContent).toBe("1");
      const secondRowCells = rows[1].querySelectorAll('[role="cell"]');
      expect(secondRowCells[0].textContent).toBe("2");
    });
  });

  // ── Resizable columns tests ──────────────────────────────────────

  describe("resizable columns", () => {
    it("renders resize handles for each column", () => {
      render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);
      expect(screen.getByTestId("resize-handle-0")).toBeInTheDocument();
      expect(screen.getByTestId("resize-handle-1")).toBeInTheDocument();
      expect(screen.getByTestId("resize-handle-2")).toBeInTheDocument();
    });

    it("resize handles have col-resize cursor", () => {
      render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);
      const handle = screen.getByTestId("resize-handle-0");
      expect(handle.style.cursor).toBe("col-resize");
    });

    it("columns use explicit pixel widths (not repeat/minmax)", () => {
      const { container } = render(
        <ResultGrid result={baseResult} isQuerying={false} height={400} />
      );
      const headerRow = container.querySelector('[role="row"]') as HTMLElement;
      expect(headerRow).toBeTruthy();
      // Should be pixel-based, e.g. "180px 180px 180px", not repeat()
      const gridCols = headerRow.style.gridTemplateColumns;
      expect(gridCols).toMatch(/\d+px/);
      expect(gridCols).not.toContain("repeat");
    });
  });

  // ── Row selection tests ──────────────────────────────────────────

  describe("row selection", () => {
    beforeEach(() => {
      useStore.setState({ selectedRowIndex: null, isDetailOpen: false });
    });

    it("clicking a row selects it and opens detail sidebar", () => {
      render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);
      const row = screen.getByTestId("result-row-0");
      fireEvent.click(row);

      expect(useStore.getState().selectedRowIndex).toBe(0);
      expect(useStore.getState().isDetailOpen).toBe(true);
    });

    it("selected row has accent background", () => {
      useStore.setState({ selectedRowIndex: 0, isDetailOpen: true });
      render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);

      const row = screen.getByTestId("result-row-0");
      expect(row.style.background).toBe("var(--accent-bg)");
    });

    it("selected row has accent left border", () => {
      useStore.setState({ selectedRowIndex: 0, isDetailOpen: true });
      render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);

      const row = screen.getByTestId("result-row-0");
      expect(row.style.borderLeft).toBe("2px solid var(--accent)");
    });

    it("rows are clickable with pointer cursor", () => {
      render(<ResultGrid result={baseResult} isQuerying={false} height={400} />);
      const row = screen.getByTestId("result-row-0");
      expect(row.style.cursor).toBe("pointer");
    });
  });
});
