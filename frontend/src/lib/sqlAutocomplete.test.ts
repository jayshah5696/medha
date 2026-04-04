import { describe, expect, it } from "vitest";

import { buildSqlCompletionOptions } from "./sqlAutocomplete";

describe("buildSqlCompletionOptions", () => {
  it("builds file and column completions from the active schema", () => {
    const options = buildSqlCompletionOptions(
      ["users.csv", "orders.parquet"],
      {
        "users.csv": [
          { name: "id", type: "INTEGER" },
          { name: "email", type: "VARCHAR" },
        ],
        "orders.parquet": [{ name: "order_total", type: "DOUBLE" }],
      },
    );

    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "id", type: "property" }),
        expect.objectContaining({ label: "email", type: "property" }),
        expect.objectContaining({ label: "order_total", type: "property" }),
        expect.objectContaining({ label: "users.csv", type: "text" }),
        expect.objectContaining({ label: "orders.parquet", type: "text" }),
      ]),
    );
  });
});
