import "./TabBar.css";
import { useState, useRef, useEffect } from "react";
import { X, Plus } from "lucide-react";
import { useStore } from "../store";
import { renameQuery } from "../lib/api";

export default function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const openTab = useStore((s) => s.openTab);
  const markTabSaved = useStore((s) => s.markTabSaved);
  const addToast = useStore((s) => s.addToast);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  const handleRenameSubmit = async (tabId: string, oldName: string) => {
    if (!editName.trim() || editName === oldName) {
      setEditingTabId(null);
      return;
    }
    try {
      if (!oldName.startsWith("untitled-")) {
        await renameQuery(oldName, editName);
      }
      markTabSaved(tabId, editName);
      addToast(`Renamed to ${editName}`);
    } catch (err) {
      addToast(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setEditingTabId(null);
  };

  return (
    <div className="tabbar-root">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tabbar-tab ${isActive ? "tabbar-tab--active" : ""}`}
            onDoubleClick={() => {
              setEditingTabId(tab.id);
              setEditName(tab.filename);
            }}
          >
            {editingTabId === tab.id ? (
              <input
                ref={inputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => handleRenameSubmit(tab.id, tab.filename)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleRenameSubmit(tab.id, tab.filename);
                  } else if (e.key === "Escape") {
                    setEditingTabId(null);
                  }
                }}
                className="tabbar-input"
                style={{ width: `${Math.max(editName.length + 1, 5)}ch` }}
              />
            ) : (
              <span>
                {tab.filename}
                {tab.isDirty ? "*" : ""}
              </span>
            )}
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="tabbar-close"
              title="Close tab"
            >
              <X size={12} />
            </span>
          </div>
        );
      })}
      <div
        onClick={() => openTab()}
        className="tabbar-new"
        title="New tab"
      >
        <Plus size={14} />
      </div>
    </div>
  );
}
