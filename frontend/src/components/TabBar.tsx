import { useStore } from "../store";

export default function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const openTab = useStore((s) => s.openTab);

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
          >
            <span>
              {tab.filename}
              {tab.isDirty ? "*" : ""}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
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
            >
              x
            </span>
          </div>
        );
      })}
      <div
        onClick={() => openTab()}
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
      >
        +
      </div>
    </div>
  );
}
