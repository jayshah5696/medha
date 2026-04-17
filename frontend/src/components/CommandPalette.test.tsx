import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CommandPalette from "./CommandPalette";

describe("CommandPalette", () => {
  const actions = [
    { label: "Run Query", shortcut: "⌘↵", action: vi.fn(), category: "Query" },
    { label: "Format SQL", shortcut: "⇧⌥F", action: vi.fn(), category: "Edit" },
    { label: "Save Query", shortcut: "⌘S", action: vi.fn(), category: "File" },
    { label: "Toggle Theme", shortcut: "", action: vi.fn(), category: "View" },
    { label: "Open History", shortcut: "⌘H", action: vi.fn(), category: "Query" },
  ];

  beforeEach(() => {
    actions.forEach((a) => a.action.mockClear());
  });

  it("renders all actions when search is empty", () => {
    render(<CommandPalette actions={actions} onClose={vi.fn()} />);
    expect(screen.getByText("Run Query")).toBeInTheDocument();
    expect(screen.getByText("Format SQL")).toBeInTheDocument();
    expect(screen.getByText("Save Query")).toBeInTheDocument();
    expect(screen.getByText("Toggle Theme")).toBeInTheDocument();
    expect(screen.getByText("Open History")).toBeInTheDocument();
  });

  it("filters actions by search input (fuzzy)", async () => {
    render(<CommandPalette actions={actions} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search commands/i);

    fireEvent.change(input, { target: { value: "query" } });

    await waitFor(() => {
      expect(screen.getByText("Run Query")).toBeInTheDocument();
      expect(screen.getByText("Save Query")).toBeInTheDocument();
      expect(screen.queryByText("Toggle Theme")).not.toBeInTheDocument();
    });
  });

  it("executes action and closes on click", () => {
    const onClose = vi.fn();
    render(<CommandPalette actions={actions} onClose={onClose} />);

    fireEvent.click(screen.getByText("Format SQL"));

    expect(actions[1].action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<CommandPalette actions={actions} onClose={onClose} />);

    fireEvent.keyDown(screen.getByPlaceholderText(/search commands/i), {
      key: "Escape",
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("navigates with arrow keys and Enter", () => {
    const onClose = vi.fn();
    render(<CommandPalette actions={actions} onClose={onClose} />);
    const input = screen.getByPlaceholderText(/search commands/i);

    // Arrow down to second item
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(actions[1].action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("displays category labels", () => {
    render(<CommandPalette actions={actions} onClose={vi.fn()} />);
    expect(screen.getByText("Query")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
  });

  it("displays shortcut text", () => {
    render(<CommandPalette actions={actions} onClose={vi.fn()} />);
    expect(screen.getByText("⌘↵")).toBeInTheDocument();
    expect(screen.getByText("⇧⌥F")).toBeInTheDocument();
  });
});
