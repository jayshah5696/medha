import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultGrid from "./ResultGrid";

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
  });
});
