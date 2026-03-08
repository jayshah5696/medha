import "./SidebarSection.css";
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
    <div className="ss-root">
      {/* Header */}
      <div onClick={handleToggle} className="ss-header">
        <span className="ss-arrow">
          {open ? "\u25BC" : "\u25B6"}
        </span>
        <span className="ss-title">{title}</span>
        {actions && (
          <span
            onClick={(e) => e.stopPropagation()}
            className="ss-actions"
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
