import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";
import type { SqlTab } from "./store";

function makeTab(overrides: Partial<SqlTab> = {}): SqlTab {
  return {
    id: crypto.randomUUID(),
    filename: "untitled-1.sql",
    content: "SELECT 1;",
    savedContent: "",
    isDirty: true,
    isNew: true,
    ...overrides,
  };
}

describe("store", () => {
  beforeEach(() => {
    const tab = makeTab();
    // Reset store state before each test
    useStore.setState({
      historyVersion: 0,
      resultPaneHeight: 250,
      activeFiles: [],
      editorContent: "SELECT 1;",
      tabs: [tab],
      activeTabId: tab.id,
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

describe("tab management", () => {
  beforeEach(() => {
    const tab = makeTab();
    useStore.setState({
      tabs: [tab],
      activeTabId: tab.id,
      editorContent: "SELECT 1;",
    });
  });

  it("starts with one untitled tab", () => {
    const { tabs, activeTabId } = useStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].filename).toBe("untitled-1.sql");
    expect(tabs[0].isDirty).toBe(true);
    expect(tabs[0].isNew).toBe(true);
    expect(activeTabId).toBe(tabs[0].id);
  });

  it("openTab() with no args creates a new untitled tab", () => {
    useStore.getState().openTab();
    const { tabs, activeTabId } = useStore.getState();
    expect(tabs).toHaveLength(2);
    expect(tabs[1].filename).toBe("untitled-2.sql");
    expect(tabs[1].isNew).toBe(true);
    expect(activeTabId).toBe(tabs[1].id);
  });

  it("openTab(filename, content) opens a saved query tab", () => {
    useStore.getState().openTab("test.sql", "SELECT * FROM test;");
    const { tabs, activeTabId } = useStore.getState();
    expect(tabs).toHaveLength(2);
    const newTab = tabs[1];
    expect(newTab.filename).toBe("test.sql");
    expect(newTab.content).toBe("SELECT * FROM test;");
    expect(newTab.savedContent).toBe("SELECT * FROM test;");
    expect(newTab.isDirty).toBe(false);
    expect(newTab.isNew).toBe(false);
    expect(activeTabId).toBe(newTab.id);
  });

  it("openTab() with existing filename switches to it", () => {
    useStore.getState().openTab("test.sql", "SELECT 1;");
    const tabId = useStore.getState().activeTabId;
    // Switch back to first tab
    useStore.getState().setActiveTab(useStore.getState().tabs[0].id);
    // Open same file again — should switch, not create new
    useStore.getState().openTab("test.sql", "SELECT 1;");
    const { tabs, activeTabId } = useStore.getState();
    expect(tabs).toHaveLength(2);
    expect(activeTabId).toBe(tabId);
  });

  it("closeTab() removes the tab and switches to neighbor", () => {
    useStore.getState().openTab("a.sql", "SELECT a;");
    useStore.getState().openTab("b.sql", "SELECT b;");
    const { tabs } = useStore.getState();
    expect(tabs).toHaveLength(3);

    // Close the middle tab (a.sql)
    const middleId = tabs[1].id;
    useStore.getState().setActiveTab(middleId);
    useStore.getState().closeTab(middleId);

    const state = useStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs.find((t) => t.id === middleId)).toBeUndefined();
  });

  it("closeTab() on last tab creates a fresh untitled", () => {
    const { tabs } = useStore.getState();
    useStore.getState().closeTab(tabs[0].id);
    const state = useStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].filename).toBe("untitled-1.sql");
    expect(state.tabs[0].isNew).toBe(true);
  });

  it("updateTabContent() sets content and recomputes isDirty", () => {
    const { tabs } = useStore.getState();
    const tabId = tabs[0].id;

    useStore.getState().updateTabContent(tabId, "SELECT 2;");
    let tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.content).toBe("SELECT 2;");
    expect(tab.isDirty).toBe(true); // savedContent is ""

    // Mark as saved first
    useStore.getState().markTabSaved(tabId);
    tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.isDirty).toBe(false);
    expect(tab.savedContent).toBe("SELECT 2;");

    // Change again
    useStore.getState().updateTabContent(tabId, "SELECT 3;");
    tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.isDirty).toBe(true);
  });

  it("markTabSaved() clears isDirty and updates filename", () => {
    const { tabs } = useStore.getState();
    const tabId = tabs[0].id;

    useStore.getState().updateTabContent(tabId, "SELECT 42;");
    useStore.getState().markTabSaved(tabId, "my-query.sql");

    const tab = useStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.isDirty).toBe(false);
    expect(tab.isNew).toBe(false);
    expect(tab.filename).toBe("my-query.sql");
    expect(tab.savedContent).toBe("SELECT 42;");
  });

  it("setActiveTab() updates editorContent to the switched tab", () => {
    useStore.getState().openTab("other.sql", "SELECT other;");
    const otherTabId = useStore.getState().activeTabId;

    // Switch back to first tab
    const firstTabId = useStore.getState().tabs[0].id;
    useStore.getState().setActiveTab(firstTabId);
    expect(useStore.getState().editorContent).toBe("SELECT 1;");

    // Switch to second tab
    useStore.getState().setActiveTab(otherTabId);
    expect(useStore.getState().editorContent).toBe("SELECT other;");
  });
});
