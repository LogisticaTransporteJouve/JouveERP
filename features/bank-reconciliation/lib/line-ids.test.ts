import { describe, expect, it } from "vitest";

import { lineIdsOf } from "./line-ids";

describe("lineIdsOf", () => {
  it("reads the line ids of every line write's input", () => {
    expect(lineIdsOf("a")).toEqual(["a"]);
    expect(lineIdsOf({ line_id: "b", receipt_id: "r" })).toEqual(["b"]);
    expect(lineIdsOf({ line_ids: ["c", "d"], transaction_id: "t" })).toEqual([
      "c",
      "d",
    ]);
    expect(lineIdsOf([{ line_id: "e" }, { line_id: "f" }])).toEqual(["e", "f"]);
  });

  it("finds none in an input without a line", () => {
    expect(lineIdsOf(undefined)).toEqual([]);
    expect(lineIdsOf({ statement_id: "s" })).toEqual([]);
  });
});
