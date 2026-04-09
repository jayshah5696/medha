import { useState } from "react";
import { useStore } from "../store";
import ChatSidebar from "./ChatSidebar";
import RecordDetailSidebar from "./RecordDetailSidebar";
import type { QueryResult } from "../lib/api";

type RightTab = "assistant" | "detail";

interface RightSidebarProps {
  width: number;
  queryResult: QueryResult | null;
}

export default function RightSidebar({ width, queryResult }: RightSidebarProps) {
  const isDetailOpen = useStore((s) => s.isDetailOpen);
  const selectedRowIndex = useStore((s) => s.selectedRowIndex);

  // Auto-switch to detail tab when a row is selected
  const [activeTab, setActiveTab] = useState<RightTab>("assistant");

  // If detail was just opened and a row is selected, switch to detail tab
  const effectiveTab =
    isDetailOpen && selectedRowIndex !== null && queryResult && queryResult.rows.length > 0
      ? "detail"
      : activeTab === "detail" && (!isDetailOpen || selectedRowIndex === null)
        ? "assistant"
        : activeTab;

  const setDetailOpen = useStore((s) => s.setDetailOpen);

  const handleTabChange = (tab: RightTab) => {
    if (tab === "detail") {
      if (!queryResult || selectedRowIndex === null || queryResult.rows.length === 0) {
        return;
      }
      setDetailOpen(true);
      setActiveTab("detail");
      return;
    }

    setActiveTab("assistant");
    // Clear detail state when user explicitly switches to assistant
    // so the effectiveTab ternary doesn't override them back
    setDetailOpen(false);
  };

  const hasResults = queryResult && queryResult.rows.length > 0;
  const canShowDetail = Boolean(hasResults && selectedRowIndex !== null);

  return (
    <div
      style={{
        width,
        minWidth: width,
        background: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          height: 28,
          minHeight: 28,
        }}
      >
        <button
          type="button"
          onClick={() => handleTabChange("assistant")}
          style={{
            flex: 1,
            background: effectiveTab === "assistant" ? "var(--bg-secondary)" : "var(--bg-primary)",
            border: "none",
            borderBottom: effectiveTab === "assistant" ? "2px solid var(--accent)" : "2px solid transparent",
            color: effectiveTab === "assistant" ? "var(--accent)" : "var(--text-dimmed)",
            fontSize: "var(--font-size-sm)",
            fontFamily: "var(--font-ui)",
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            cursor: "pointer",
            padding: "0 8px",
          }}
        >
          Assistant
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("detail")}
          data-testid="right-tab-detail"
          disabled={!canShowDetail}
          style={{
            flex: 1,
            background: effectiveTab === "detail" ? "var(--bg-secondary)" : "var(--bg-primary)",
            border: "none",
            borderBottom: effectiveTab === "detail" ? "2px solid var(--accent)" : "2px solid transparent",
            color: effectiveTab === "detail"
              ? "var(--accent)"
              : canShowDetail
                ? "var(--text-secondary)"
                : "var(--text-dimmed)",
            fontSize: "var(--font-size-sm)",
            fontFamily: "var(--font-ui)",
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            cursor: canShowDetail ? "pointer" : "not-allowed",
            padding: "0 8px",
            opacity: canShowDetail ? 1 : 0.5,
          }}
        >
          Detail
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {effectiveTab === "assistant" ? (
          <ChatSidebar width={width} />
        ) : hasResults ? (
          <RecordDetailSidebar result={queryResult} width={width} />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-dimmed)",
              fontSize: "var(--font-size-sm)",
              fontFamily: "var(--font-ui)",
              padding: 24,
              textAlign: "center",
            }}
          >
            Run a query to see record details
          </div>
        )}
      </div>
    </div>
  );
}
