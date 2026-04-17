import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useStore } from "../store";
import SqlEditor from "./SqlEditor";

vi.mock("../lib/api", () => ({
  getHistory: vi.fn().mockResolvedValue([]),
  getHistoryEntry: vi.fn(),
  getSchema: vi.fn().mockResolvedValue({ filename: "sample.csv", columns: [] }),
  saveQuery: vi.fn(),
}));

describe("SqlEditor", () => {
  beforeEach(() => {
    useStore.setState({
      editorContent: "SELECT 1;",
      isQuerying: false,
      files: [],
      activeFiles: [],
    });
  });

  it("formats the current SQL from the toolbar", async () => {
    render(<SqlEditor initialValue="select id,name from users where id=1" />);

    fireEvent.click(screen.getByRole("button", { name: /format sql/i }));

    await waitFor(() => {
      const editorApi = (window as unknown as {
        __medhaEditor?: { getContent: () => string };
      }).__medhaEditor;
      expect(editorApi?.getContent()).toContain("SELECT\n  id,");
    });
  });

  it("calls onCancel when the query is running", () => {
    const onCancel = vi.fn();
    useStore.setState({ isQuerying: true });

    render(<SqlEditor onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel query/i }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("toolbar Run button shows 'Run Selection' when store has selectedSql", async () => {
    const onExecute = vi.fn();
    useStore.setState({ selectedSql: "SELECT 42;" });

    render(<SqlEditor initialValue="SELECT 1;\nSELECT 42;" onExecute={onExecute} />);

    const runBtn = screen.getByRole("button", { name: /run/i });
    expect(runBtn).toHaveTextContent(/selection/i);
  });

  it("toolbar Run button sends full content when no selection", async () => {
    const onExecute = vi.fn();
    useStore.setState({ selectedSql: null });

    render(<SqlEditor initialValue="SELECT 1;" onExecute={onExecute} />);

    const runBtn = screen.getByRole("button", { name: /run/i });
    expect(runBtn).toHaveTextContent("⌘↵ Run");
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith("SELECT 1;");
    });
  });

  it("offers Fix with AI when a query error is present", async () => {
    const onCmdK = vi.fn();

    render(
      <SqlEditor
        initialValue="SELEKT 1;"
        queryError="Parser Error: syntax error at or near 'SELEKT'"
        onCmdK={onCmdK}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /fix query with ai/i }));

    await waitFor(() => {
      expect(onCmdK).toHaveBeenCalledOnce();
    });

    expect(onCmdK).toHaveBeenCalledWith(
      "SELEKT 1;",
      expect.anything(),
      expect.objectContaining({
        errorMessage: "Parser Error: syntax error at or near 'SELEKT'",
        initialInstruction: expect.stringMatching(/fix this duckdb sql error/i),
      }),
    );
  });
});
