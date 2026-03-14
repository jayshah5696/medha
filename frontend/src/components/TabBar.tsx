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
    <div
      style={{
        height: 28,
        minHeight: 28,
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
        overflow: "hidden",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--font-size-sm)",
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "0 10px",
              cursor: "pointer",
              color: isActive ? "var(--text-primary)" : "var(--text-dimmed)",
              borderBottom: isActive
                ? "2px solid var(--accent)"
                : "2px solid transparent",
              borderRight: "1px solid var(--border)",
              whiteSpace: "nowrap",
              userSelect: "none",
              transition: "color 0.1s",
            }}
            onMouseEnter={(e) => {
              if (!isActive)
                (e.currentTarget as HTMLDivElement).style.color =
                  "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              if (!isActive)
                (e.currentTarget as HTMLDivElement).style.color =
                  "var(--text-dimmed)";
            }}
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
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-primary)",
                  outline: "none",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--font-size-sm)",
                  width: `${Math.max(editName.length + 1, 5)}ch`,
                  minWidth: "40px",
                }}
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
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  closeTab(tab.id);
                }
              }}
              style={{
                marginLeft: 2,
                padding: "0 2px",
                lineHeight: 1,
                fontSize: "var(--font-size-xs)",
                color: "var(--text-dimmed)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLSpanElement).style.color =
                  "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLSpanElement).style.color =
                  "var(--text-dimmed)";
              }}
              title="Close tab"
              aria-label="Close tab"
              role="button"
              tabIndex={0}
            >
              <X size={12} />
            </span>
          </div>
        );
      })}
      <div
        onClick={() => openTab()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openTab();
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          cursor: "pointer",
          color: "var(--text-dimmed)",
          fontSize: "var(--font-size-sm)",
          userSelect: "none",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.color =
            "var(--text-dimmed)";
        }}
        title="New tab"
        aria-label="New tab"
        role="button"
        tabIndex={0}
      >
        <Plus size={14} />
      </div>
    </div>
  );
}
