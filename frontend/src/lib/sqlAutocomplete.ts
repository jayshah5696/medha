import type { Completion } from "@codemirror/autocomplete";

import type { SchemaColumn } from "./api";

export function buildSqlCompletionOptions(
  activeFiles: string[],
  schemaByFile: Record<string, SchemaColumn[]>,
): Completion[] {
  const seenColumns = new Set<string>();
  const options: Completion[] = [];

  for (const file of activeFiles) {
    options.push({
      label: file,
      type: "text",
      apply: `'${file}'`,
      detail: "file",
    });

    for (const column of schemaByFile[file] ?? []) {
      if (seenColumns.has(column.name)) {
        continue;
      }
      seenColumns.add(column.name);
      options.push({
        label: column.name,
        type: "property",
        detail: column.type,
      });
    }
  }

  return options;
}
