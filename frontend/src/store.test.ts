import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

describe("store", () => {
  beforeEach(() => {
    // Reset store state before each test
    useStore.setState({
      historyVersion: 0,
      resultPaneHeight: 250,
      activeFiles: [],
      editorContent: "SELECT 1;",
    });
  });

  // BUG-4: historyVersion counter
  it("historyVersion starts at 0", () => {
    expect(useStore.getState().historyVersion).toBe(0);
  });

  it("bumpHistoryVersion increments the counter", () => {
    useStore.getState().bumpHistoryVersion();
    expect(useStore.getState().historyVersion).toBe(1);
    useStore.getState().bumpHistoryVersion();
    expect(useStore.getState().historyVersion).toBe(2);
  });

  // FEAT-1: resultPaneHeight
  it("resultPaneHeight defaults to 250", () => {
    expect(useStore.getState().resultPaneHeight).toBe(250);
  });

  it("setResultPaneHeight updates the height", () => {
    useStore.getState().setResultPaneHeight(400);
    expect(useStore.getState().resultPaneHeight).toBe(400);
  });

  // Existing store behavior
  it("toggleActiveFile adds and removes files", () => {
    useStore.getState().toggleActiveFile("test.csv");
    expect(useStore.getState().activeFiles).toContain("test.csv");
    useStore.getState().toggleActiveFile("test.csv");
    expect(useStore.getState().activeFiles).not.toContain("test.csv");
  });

  it("loadHistoryEntry sets editorContent", () => {
    useStore.getState().loadHistoryEntry("SELECT * FROM foo;");
    expect(useStore.getState().editorContent).toBe("SELECT * FROM foo;");
  });
});
