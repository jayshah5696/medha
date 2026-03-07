import { useState } from "react";

interface SidebarSectionProps {
  title: string;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * FEAT-8-1: Reusable collapsible sidebar section.
 *
 * Renders a header row with a toggle arrow, title text, and optional
 * action buttons on the right. Content is shown/hidden on toggle.
 */
export default function SidebarSection({
  title,
  defaultOpen = true,
  actions,
  onToggle,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  };

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Header */}
      <div
        onClick={handleToggle}
        style={{
          padding: "6px 12px",
          fontSize: "var(--font-size-sm)",
          fontWeight: 500,
          textTransform: "uppercase",
          color: "var(--text-dimmed)",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-ui)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: "var(--font-size-xs)", width: 12 }}>
          {open ? "\u25BC" : "\u25B6"}
        </span>
        <span style={{ flex: 1 }}>{title}</span>
        {actions && (
          <span
            onClick={(e) => e.stopPropagation()}
            style={{ display: "flex", gap: 4 }}
          >
            {actions}
          </span>
        )}
      </div>

      {/* Content */}
      {open && children}
    </div>
  );
}
