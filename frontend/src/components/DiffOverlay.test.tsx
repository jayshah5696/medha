import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { useStore } from "../store";
import { inlineEdit } from "../lib/api";
import DiffOverlay from "./DiffOverlay";

vi.mock("../lib/api", () => ({
  inlineEdit: vi.fn(),
}));

describe("DiffOverlay", () => {
  let editorParent: HTMLDivElement;
  let editorView: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ activeFiles: ["sample.csv"] });

    editorParent = document.createElement("div");
    document.body.appendChild(editorParent);
    editorView = new EditorView({
      state: EditorState.create({ doc: "SELEKT 1;" }),
      parent: editorParent,
    });
  });

  afterEach(() => {
    editorView.destroy();
    editorParent.remove();
  });

  it("auto-submits the AI fix flow when initial repair context is provided", async () => {
    vi.mocked(inlineEdit).mockResolvedValue({ sql: "SELECT 1;" });
    const onClose = vi.fn();

    render(
      <DiffOverlay
        selectedSql="SELEKT 1;"
        editorView={editorView}
        initialInstruction="Fix this DuckDB SQL error. Make the smallest change needed to resolve it."
        errorMessage="Parser Error: syntax error at or near 'SELEKT'"
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(inlineEdit).toHaveBeenCalledWith(
        "Fix this DuckDB SQL error. Make the smallest change needed to resolve it.",
        "SELEKT 1;",
        ["sample.csv"],
        undefined,
        "Parser Error: syntax error at or near 'SELEKT'",
      );
    });

    expect(await screen.findByRole("button", { name: /accept/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    expect(editorView.state.doc.toString()).toBe("SELECT 1;");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
