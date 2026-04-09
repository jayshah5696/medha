export interface ToolStepData {
  id: string;
  tool: string;
  status: "running" | "done" | "error";
  context?: string;
  durationMs?: number;
}

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
  if (status === "running") return `running ${tool}`;
  if (status === "done") return `completed ${tool}`;
  return `failed ${tool}`;
}
