import { useState, useEffect, useRef, useMemo, useCallback } from "react";

export interface CommandAction {
  label: string;
  shortcut: string;
  action: () => void;
  category: string;
}

interface CommandPaletteProps {
  actions: CommandAction[];
  onClose: () => void;
}

export default function CommandPalette({ actions, onClose }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Filter actions by search term (case-insensitive substring match)
  const filtered = useMemo(() => {
    if (!search.trim()) return actions;
    const q = search.toLowerCase();
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q),
    );
  }, [actions, search]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setSelectedIndex(0);
    },
    [],
  );

  const executeAction = useCallback(
    (action: CommandAction) => {
      action.action();
      onClose();
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          executeAction(filtered[selectedIndex]);
        }
        return;
      }
    },
    [filtered, selectedIndex, onClose, executeAction],
  );

  // Group filtered actions by category
  const grouped = useMemo(() => {
    const groups: { category: string; items: (CommandAction & { globalIdx: number })[] }[] = [];
    const categoryMap = new Map<string, (CommandAction & { globalIdx: number })[]>();

    filtered.forEach((a, idx) => {
      const existing = categoryMap.get(a.category);
      const item = { ...a, globalIdx: idx };
      if (existing) {
        existing.push(item);
      } else {
        const arr = [item];
        categoryMap.set(a.category, arr);
        groups.push({ category: a.category, items: arr });
      }
    });

    return groups;
  }, [filtered]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        justifyContent: "center",
        paddingTop: "15vh",
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 500,
          maxWidth: "90vw",
          maxHeight: "60vh",
          background: "var(--bg-elevated, var(--bg-secondary))",
          border: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          alignSelf: "flex-start",
        }}
      >
        {/* Search input */}
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Search commands..."
            value={search}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            style={{
              width: "100%",
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontSize: "var(--font-size-lg)",
              fontFamily: "var(--font-ui)",
              padding: "8px 12px",
              outline: "none",
            }}
          />
        </div>

        {/* Action list */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {grouped.map((group) => (
            <div key={group.category}>
              <div
                style={{
                  padding: "6px 14px",
                  fontSize: "var(--font-size-xs)",
                  fontFamily: "var(--font-ui)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--text-dimmed)",
                  background: "var(--bg-secondary)",
                }}
              >
                {group.category}
              </div>
              {group.items.map((item) => (
                <div
                  key={item.label}
                  onClick={() => executeAction(item)}
                  style={{
                    padding: "8px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    background:
                      item.globalIdx === selectedIndex
                        ? "var(--accent-bg)"
                        : "transparent",
                    borderLeft:
                      item.globalIdx === selectedIndex
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                  }}
                  onMouseEnter={() => setSelectedIndex(item.globalIdx)}
                >
                  <span
                    style={{
                      fontSize: "var(--font-size-md)",
                      fontFamily: "var(--font-ui)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {item.label}
                  </span>
                  {item.shortcut && (
                    <span
                      style={{
                        fontSize: "var(--font-size-xs)",
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-dimmed)",
                        flexShrink: 0,
                      }}
                    >
                      {item.shortcut}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: "14px",
                textAlign: "center",
                color: "var(--text-dimmed)",
                fontSize: "var(--font-size-base)",
                fontFamily: "var(--font-ui)",
              }}
            >
              No matching commands
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
