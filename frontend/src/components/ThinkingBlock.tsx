/**
 * ThinkingBlock — collapsible container for agent tool activity steps.
 *
 * Renders between the user message and assistant response.
 * Auto-expands while streaming, collapses after the agent finishes.
 * Click the header to toggle open/closed.
 *
 * Layout:
 *   ◉ thinking · 3 steps          ▼
 *     ● inspected schema · sample.csv   50ms
 *     ● sampled data · sample.csv      120ms
 *     ● executing query · SELECT...     ←pulse
 */

import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import ToolStep from "./ToolStep";
import type { ToolStepData } from "./ToolStep";

interface ThinkingBlockProps {
  steps: ToolStepData[];
  isStreaming: boolean;
}

export default function ThinkingBlock({ steps, isStreaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(isStreaming);
  const prevStreaming = useRef(isStreaming);

  // Auto-collapse when streaming transitions from true -> false
  useEffect(() => {
    if (prevStreaming.current && !isStreaming) {
      // Streaming just ended — collapse
      setExpanded(false);
    } else if (isStreaming && steps.length > 0) {
      // Streaming with steps — expand
      setExpanded(true);
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, steps.length]);

  if (steps.length === 0) return null;

  const hasRunning = steps.some((s) => s.status === "running");
  const stepCount = steps.length;
  const label = `${stepCount} step${stepCount !== 1 ? "s" : ""}`;

  return (
    <div
      style={{
        margin: "4px 0",
        fontSize: "var(--font-size-xs)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {/* Header — clickable toggle */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          cursor: "pointer",
          userSelect: "none",
          color: "var(--text-dimmed)",
        }}
      >
        {/* Thinking indicator (animated dot when running) */}
        {hasRunning && (
          <span
            data-testid="thinking-indicator"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent)",
              boxShadow: "0 0 6px var(--accent)",
              animation: "toolPulse 1.2s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
        )}
        {!hasRunning && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--text-dimmed)",
              flexShrink: 0,
              opacity: 0.5,
            }}
          />
        )}

        <span style={{ color: hasRunning ? "var(--accent)" : "var(--text-dimmed)" }}>
          {hasRunning ? "thinking" : label}
        </span>

        <span
          style={{
            fontSize: "var(--font-size-xs)",
            transition: "transform 0.15s",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            marginLeft: "auto",
          }}
        >
          <ChevronDown size={12} />
        </span>
      </div>

      {/* Steps — only shown when expanded */}
      {expanded && (
        <div
          style={{
            borderLeft: "1px solid var(--border)",
            marginLeft: 11,
            animation: "fadeUp 0.15s ease both",
          }}
        >
          {steps.map((step) => (
            <ToolStep key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
