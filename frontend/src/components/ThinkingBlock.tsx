import "./ThinkingBlock.css";
import { ChevronDown } from "lucide-react";
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
    <div className="tb-root">
      {/* Header — clickable toggle */}
      <div
        onClick={() => setExpanded((v) => !v)}
        className="tb-header"
      >
        {/* Thinking indicator (animated dot when running) */}
        {hasRunning && (
          <span
            data-testid="thinking-indicator"
            className="tb-dot tb-dot--running"
          />
        )}
        {!hasRunning && (
          <span className="tb-dot tb-dot--idle" />
        )}

        <span className={hasRunning ? "tb-label--running" : "tb-label--idle"}>
          {hasRunning ? "thinking" : label}
        </span>

        <span
          className={`tb-chevron ${expanded ? "tb-chevron--expanded" : "tb-chevron--collapsed"}`}
        >
          <ChevronDown size={12} />
        </span>
      </div>

      {/* Steps — only shown when expanded */}
      {expanded && (
        <div className="tb-steps">
          {steps.map((step) => (
            <ToolStep key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
