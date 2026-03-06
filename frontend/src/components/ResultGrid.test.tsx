import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultGrid from "./ResultGrid";

describe("ResultGrid", () => {
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
    render(<ResultGrid result={baseResult} isQuerying={false} />);
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("score")).toBeInTheDocument();
  });

  it("renders row data", () => {
    render(<ResultGrid result={baseResult} isQuerying={false} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("85.5")).toBeInTheDocument();
  });

  it("shows truncation badge when truncated=true", () => {
    const truncatedResult = { ...baseResult, truncated: true };
    render(<ResultGrid result={truncatedResult} isQuerying={false} />);
    expect(screen.getByText("TRUNCATED")).toBeInTheDocument();
  });

  it("shows row count and duration", () => {
    render(<ResultGrid result={baseResult} isQuerying={false} />);
    expect(screen.getByText("2 rows")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
  });

  it("no truncation badge when truncated=false", () => {
    render(<ResultGrid result={baseResult} isQuerying={false} />);
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
});
