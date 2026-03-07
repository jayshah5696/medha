import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ToolStep, { toolVerb, type ToolStepData } from "./ToolStep";

describe("toolVerb", () => {
  it("maps get_schema to inspecting/inspected", () => {
    expect(toolVerb("get_schema", "running")).toBe("inspecting schema");
    expect(toolVerb("get_schema", "done")).toBe("inspected schema");
  });

  it("maps sample_data to sampling/sampled", () => {
    expect(toolVerb("sample_data", "running")).toBe("sampling data");
    expect(toolVerb("sample_data", "done")).toBe("sampled data");
  });

  it("maps execute_query to executing/executed", () => {
    expect(toolVerb("execute_query", "running")).toBe("executing query");
    expect(toolVerb("execute_query", "done")).toBe("executed query");
  });

  it("handles unknown tools gracefully", () => {
    expect(toolVerb("unknown_tool", "running")).toBe("running unknown_tool");
    expect(toolVerb("unknown_tool", "done")).toBe("completed unknown_tool");
  });

  it("handles error state", () => {
    expect(toolVerb("execute_query", "error")).toBe("failed query");
    expect(toolVerb("get_schema", "error")).toBe("failed schema");
  });
});

describe("ToolStep", () => {
  it("renders running state with tool verb", () => {
    const step: ToolStepData = {
      id: "1",
      tool: "get_schema",
      status: "running",
    };
    render(<ToolStep step={step} />);
    expect(screen.getByText(/inspecting schema/)).toBeInTheDocument();
  });

  it("renders done state with tool verb", () => {
    const step: ToolStepData = {
      id: "2",
      tool: "execute_query",
      status: "done",
      durationMs: 42,
    };
    render(<ToolStep step={step} />);
    expect(screen.getByText(/executed query/)).toBeInTheDocument();
  });

  it("shows duration badge when done", () => {
    const step: ToolStepData = {
      id: "3",
      tool: "sample_data",
      status: "done",
      durationMs: 150,
    };
    render(<ToolStep step={step} />);
    expect(screen.getByText("150ms")).toBeInTheDocument();
  });

  it("does not show duration when running", () => {
    const step: ToolStepData = {
      id: "4",
      tool: "get_schema",
      status: "running",
    };
    render(<ToolStep step={step} />);
    expect(screen.queryByText(/ms$/)).not.toBeInTheDocument();
  });

  it("shows context text when provided", () => {
    const step: ToolStepData = {
      id: "5",
      tool: "get_schema",
      status: "done",
      context: "sample.csv",
    };
    render(<ToolStep step={step} />);
    expect(screen.getByText(/sample\.csv/)).toBeInTheDocument();
  });

  it("renders error state", () => {
    const step: ToolStepData = {
      id: "6",
      tool: "execute_query",
      status: "error",
      context: "syntax error",
    };
    render(<ToolStep step={step} />);
    expect(screen.getByText(/failed query/)).toBeInTheDocument();
  });

  it("renders status dot with correct test id", () => {
    const step: ToolStepData = {
      id: "7",
      tool: "get_schema",
      status: "running",
    };
    render(<ToolStep step={step} />);
    expect(screen.getByTestId("status-dot-running")).toBeInTheDocument();
  });

  it("renders done status dot", () => {
    const step: ToolStepData = {
      id: "8",
      tool: "get_schema",
      status: "done",
    };
    render(<ToolStep step={step} />);
    expect(screen.getByTestId("status-dot-done")).toBeInTheDocument();
  });
});
