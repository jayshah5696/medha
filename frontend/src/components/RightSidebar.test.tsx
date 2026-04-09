import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RightSidebar from "./RightSidebar";
import { useStore } from "../store";
import type { QueryResult } from "../lib/api";

vi.mock("./ChatSidebar", () => ({
  default: () => <div data-testid="chat-sidebar">chat</div>,
}));

vi.mock("./RecordDetailSidebar", () => ({
  default: () => <div data-testid="record-detail-sidebar">detail</div>,
}));

const baseResult: QueryResult = {
  columns: ["id", "name"],
  rows: [[1, "Alice"]],
  truncated: false,
  row_count: 1,
  duration_ms: 5,
};

describe("RightSidebar", () => {
  beforeEach(() => {
    useStore.setState({
      selectedRowIndex: null,
      isDetailOpen: false,
      isChatOpen: true,
    });
  });

  it("shows detail view when a row is selected and detail is open", () => {
    useStore.setState({ selectedRowIndex: 0, isDetailOpen: true });
    render(<RightSidebar width={320} queryResult={baseResult} />);

    expect(screen.getByTestId("record-detail-sidebar")).toBeInTheDocument();
  });

  it("lets the user switch from detail back to assistant", () => {
    useStore.setState({ selectedRowIndex: 0, isDetailOpen: true });
    render(<RightSidebar width={320} queryResult={baseResult} />);

    fireEvent.click(screen.getByRole("button", { name: /assistant/i }));

    expect(useStore.getState().isDetailOpen).toBe(false);
    expect(screen.getByTestId("chat-sidebar")).toBeInTheDocument();
  });

  it("lets the user re-open detail from the tab after switching back to assistant", () => {
    useStore.setState({ selectedRowIndex: 0, isDetailOpen: true });
    render(<RightSidebar width={320} queryResult={baseResult} />);

    fireEvent.click(screen.getByRole("button", { name: /assistant/i }));
    fireEvent.click(screen.getByRole("button", { name: /detail/i }));

    expect(useStore.getState().isDetailOpen).toBe(true);
    expect(screen.getByTestId("record-detail-sidebar")).toBeInTheDocument();
  });

  it("disables the detail tab when no row is selected", () => {
    render(<RightSidebar width={320} queryResult={baseResult} />);

    expect(screen.getByRole("button", { name: /detail/i })).toBeDisabled();
  });
});
