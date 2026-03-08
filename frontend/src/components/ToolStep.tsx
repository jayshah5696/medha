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

import "./ToolStep.css";

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

// --- Component ---

export default function ToolStep({ step }: { step: ToolStepData }) {
  const verb = toolVerb(step.tool, step.status);

  return (
    <div className="ts-root">
      {/* Status dot */}
      <span
        data-testid={`status-dot-${step.status}`}
        className={`ts-dot ts-dot--${step.status}`}
      />

      {/* Verb + context */}
      <span className={`ts-verb ts-verb--${step.status}`}>
        {verb}
        {step.context && (
          <span className="ts-context">
            {"· "}
            {step.context}
          </span>
        )}
      </span>

      {/* Duration badge (only when done) */}
      {step.status === "done" && step.durationMs != null && (
        <span className="ts-duration">
          {step.durationMs < 1000
            ? `${Math.round(step.durationMs)}ms`
            : `${(step.durationMs / 1000).toFixed(1)}s`}
        </span>
      )}
    </div>
  );
}
