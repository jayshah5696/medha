import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ThinkingBlock from "./ThinkingBlock";
import type { ToolStepData } from "./ToolStep";

describe("ThinkingBlock", () => {
  const doneSteps: ToolStepData[] = [
    { id: "1", tool: "get_schema", status: "done", durationMs: 50 },
    { id: "2", tool: "sample_data", status: "done", durationMs: 120 },
  ];

  const runningSteps: ToolStepData[] = [
    { id: "1", tool: "get_schema", status: "done", durationMs: 50 },
    { id: "2", tool: "execute_query", status: "running" },
  ];

  it("renders nothing when steps is empty", () => {
    const { container } = render(<ThinkingBlock steps={[]} isStreaming={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders step count in header", () => {
    render(<ThinkingBlock steps={doneSteps} isStreaming={false} />);
    expect(screen.getByText(/2 steps/)).toBeInTheDocument();
  });

  it("is expanded while streaming", () => {
    render(<ThinkingBlock steps={runningSteps} isStreaming={true} />);
    // Steps should be visible when streaming — check both done and running steps
    expect(screen.getByText(/inspected schema/i)).toBeInTheDocument();
    expect(screen.getByText(/executing query/i)).toBeInTheDocument();
  });

  it("is collapsed after streaming completes", () => {
    render(<ThinkingBlock steps={doneSteps} isStreaming={false} />);
    // Steps should be hidden by default after completion
    expect(screen.queryByText(/inspected schema/i)).not.toBeInTheDocument();
  });

  it("can be toggled open when collapsed", () => {
    render(<ThinkingBlock steps={doneSteps} isStreaming={false} />);
    // Click the header to expand
    fireEvent.click(screen.getByText(/2 steps/));
    expect(screen.getByText(/inspected schema/i)).toBeInTheDocument();
  });

  it("can be toggled closed when expanded", () => {
    render(<ThinkingBlock steps={doneSteps} isStreaming={false} />);
    // Open
    fireEvent.click(screen.getByText(/2 steps/));
    expect(screen.getByText(/inspected schema/i)).toBeInTheDocument();
    // Close
    fireEvent.click(screen.getByText(/2 steps/));
    expect(screen.queryByText(/inspected schema/i)).not.toBeInTheDocument();
  });

  it("shows running indicator when streaming", () => {
    render(<ThinkingBlock steps={runningSteps} isStreaming={true} />);
    expect(screen.getByTestId("thinking-indicator")).toBeInTheDocument();
  });

  it("does not show running indicator when done", () => {
    render(<ThinkingBlock steps={doneSteps} isStreaming={false} />);
    expect(screen.queryByTestId("thinking-indicator")).not.toBeInTheDocument();
  });
});
