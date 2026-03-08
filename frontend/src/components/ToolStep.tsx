/**
 * ToolStep — compact inline tool activity indicator.
 *
 * Renders a single agent tool call as a status line:
 *   ● verb · context              duration
 *
 * Three states:
 *   running — cyan pulsing dot, italic verb
 *   done    — green dot, past-tense verb, duration badge
 *   error   — red dot, "failed" verb
 *
 * Tool-to-verb mapping keeps the UI human-readable without
 * exposing raw function names.
 */

export interface ToolStepData {
  id: string;
  tool: string;
  status: "running" | "done" | "error";
  context?: string;
  durationMs?: number;
}

// --- Verb mapping ---

const TOOL_VERBS: Record<string, { running: string; done: string; error: string }> = {
  get_schema: {
    running: "inspecting schema",
    done: "inspected schema",
    error: "failed schema",
  },
  sample_data: {
    running: "sampling data",
    done: "sampled data",
    error: "failed sampling",
  },
  execute_query: {
    running: "executing query",
    done: "executed query",
    error: "failed query",
  },
};

export function toolVerb(
  tool: string,
  status: "running" | "done" | "error"
): string {
  const verbs = TOOL_VERBS[tool];
  if (verbs) return verbs[status];
  // Fallback for unknown tools
  if (status === "running") return `running ${tool}`;
  if (status === "done") return `completed ${tool}`;
  return `failed ${tool}`;
}

// --- Status dot colors ---

const DOT_STYLES: Record<string, { background: string; boxShadow: string }> = {
  running: {
    background: "var(--accent)",
    boxShadow: "0 0 6px var(--accent)",
  },
  done: {
    background: "var(--success)",
    boxShadow: "0 0 4px var(--success)",
  },
  error: {
    background: "var(--error)",
    boxShadow: "0 0 4px var(--error)",
  },
};

// --- Component ---

export default function ToolStep({ step }: { step: ToolStepData }) {
  const verb = toolVerb(step.tool, step.status);
  const dotStyle = DOT_STYLES[step.status] || DOT_STYLES.done;
  const isRunning = step.status === "running";
  const isError = step.status === "error";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--font-size-xs)",
        lineHeight: 1.6,
        animation: "fadeUp 0.2s ease both",
      }}
    >
      {/* Status dot */}
      <span
        data-testid={`status-dot-${step.status}`}
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          ...dotStyle,
          animation: isRunning ? "toolPulse 1.2s ease-in-out infinite" : undefined,
        }}
      />

      {/* Verb + context */}
      <span
        style={{
          color: isError
            ? "var(--error)"
            : isRunning
            ? "var(--accent)"
            : "var(--text-dimmed)",
          fontStyle: isRunning ? "italic" : "normal",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {verb}
        {step.context && (
          <span style={{ color: "var(--text-dimmed)", marginLeft: 4 }}>
            {"· "}
            {step.context}
          </span>
        )}
      </span>

      {/* Duration badge (only when done) */}
      {step.status === "done" && step.durationMs != null && (
        <span
          style={{
            color: "var(--text-dimmed)",
            fontSize: "var(--font-size-xs)",
            flexShrink: 0,
            opacity: 0.6,
          }}
        >
          {step.durationMs < 1000
            ? `${Math.round(step.durationMs)}ms`
            : `${(step.durationMs / 1000).toFixed(1)}s`}
        </span>
      )}
    </div>
  );
}
