import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RecordDetailSidebar from "./RecordDetailSidebar";
import { useStore } from "../store";
import type { QueryResult } from "../lib/api";

// Reset store before each test
beforeEach(() => {
  useStore.setState({
    selectedRowIndex: null,
    isDetailOpen: true,
    toasts: [],
  });
});

const baseResult: QueryResult = {
  columns: ["id", "name", "score", "metadata"],
  rows: [
    [1, "Alice", 85.5, { role: "admin", tags: ["a", "b"] }],
    [2, "Bob", 92.0, null],
    [3, "Charlie", 78.3, '{"nested": "json_string"}'],
  ],
  truncated: false,
  row_count: 3,
  duration_ms: 42,
};

describe("RecordDetailSidebar", () => {
  it("shows empty state when no row is selected", () => {
    render(<RecordDetailSidebar result={baseResult} width={360} />);
    expect(screen.getByText("Click a row to view its details")).toBeInTheDocument();
  });

  it("shows record detail header", () => {
    render(<RecordDetailSidebar result={baseResult} width={360} />);
    expect(screen.getByText("Record Detail")).toBeInTheDocument();
  });

  it("shows field names and values in table view when a row is selected", () => {
    useStore.setState({ selectedRowIndex: 0 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    // Field names should be visible
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("score")).toBeInTheDocument();
    expect(screen.getByText("metadata")).toBeInTheDocument();

    // Values
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText("85.5")).toBeInTheDocument();
  });

  it("shows navigation with record position", () => {
    useStore.setState({ selectedRowIndex: 0 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("navigates to next record", () => {
    useStore.setState({ selectedRowIndex: 0 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    fireEvent.click(screen.getByLabelText("Next record"));
    expect(useStore.getState().selectedRowIndex).toBe(1);
  });

  it("navigates to previous record", () => {
    useStore.setState({ selectedRowIndex: 2 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    fireEvent.click(screen.getByLabelText("Previous record"));
    expect(useStore.getState().selectedRowIndex).toBe(1);
  });

  it("disables previous button on first record", () => {
    useStore.setState({ selectedRowIndex: 0 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    const prevBtn = screen.getByLabelText("Previous record");
    expect(prevBtn).toBeDisabled();
  });

  it("disables next button on last record", () => {
    useStore.setState({ selectedRowIndex: 2 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    const nextBtn = screen.getByLabelText("Next record");
    expect(nextBtn).toBeDisabled();
  });

  it("shows null values with italic styling", () => {
    useStore.setState({ selectedRowIndex: 1 }); // Bob's row has null metadata
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    // There are multiple "null" texts: the value and the type badge.
    // Find the one in the value area (with italic style)
    const nullSpans = screen.getAllByText("null");
    const italicNull = nullSpans.find(
      (el) => el.style.fontStyle === "italic"
    );
    expect(italicNull).toBeTruthy();
  });

  it("renders JSON objects as collapsible trees", () => {
    useStore.setState({ selectedRowIndex: 0 }); // Alice's row has object metadata
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    // Should render the object keys
    expect(screen.getByText(/"role"/)).toBeInTheDocument();
    expect(screen.getByText(/"tags"/)).toBeInTheDocument();
  });

  it("auto-detects and formats JSON strings", () => {
    useStore.setState({ selectedRowIndex: 2 }); // Charlie's row has a JSON string
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    // Should parse the JSON string and render it formatted
    expect(screen.getByText(/"nested"/)).toBeInTheDocument();
  });

  it("switches to JSON view mode", () => {
    useStore.setState({ selectedRowIndex: 0 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    fireEvent.click(screen.getByLabelText("JSON view"));

    // In JSON view, all keys should be rendered as a JSON tree
    expect(screen.getByText(/"id"/)).toBeInTheDocument();
    expect(screen.getByText(/"name"/)).toBeInTheDocument();
  });

  it("filters fields by search query", () => {
    useStore.setState({ selectedRowIndex: 0 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    fireEvent.change(screen.getByLabelText("Search fields"), {
      target: { value: "score" },
    });

    // Only "score" field should be visible
    expect(screen.getByText("score")).toBeInTheDocument();
    expect(screen.queryByText("name")).not.toBeInTheDocument();
    expect(screen.queryByText("id")).not.toBeInTheDocument();
  });

  it("copies field value on copy button click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    useStore.setState({ selectedRowIndex: 0 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    fireEvent.click(screen.getByLabelText("Copy name"));

    expect(writeText).toHaveBeenCalledWith("Alice");
  });

  it("copies full record as JSON", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    useStore.setState({ selectedRowIndex: 0 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    fireEvent.click(screen.getByLabelText("Copy full record as JSON"));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('"name": "Alice"')
    );
  });

  it("closes sidebar when close button is clicked", () => {
    useStore.setState({ selectedRowIndex: 0, isDetailOpen: true });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    fireEvent.click(screen.getByLabelText("Close detail sidebar"));
    expect(useStore.getState().isDetailOpen).toBe(false);
  });

  it("shows type badges for field values", () => {
    useStore.setState({ selectedRowIndex: 0 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);

    // Should show type information — "number" appears for both id and score
    const numberBadges = screen.getAllByText("number");
    expect(numberBadges.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("string")).toBeInTheDocument();
    expect(screen.getByText("object")).toBeInTheDocument();
  });

  it("has correct testid for integration testing", () => {
    useStore.setState({ selectedRowIndex: 0 });
    render(<RecordDetailSidebar result={baseResult} width={360} />);
    expect(screen.getByTestId("record-detail-sidebar")).toBeInTheDocument();
  });
});
