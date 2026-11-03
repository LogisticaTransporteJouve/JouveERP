import { describe, expect, it } from "vitest";

import { stackExtent, stackSegments } from "./chart-geometry";

describe("stackSegments", () => {
  it("stacks positives up and negatives down from zero, skipping empty values", () => {
    expect(stackSegments([10, -4, null, 5, 0, -1])).toEqual([
      { from: 0, to: 10 },
      { from: 0, to: -4 },
      null,
      { from: 10, to: 15 },
      null,
      { from: -4, to: -5 },
    ]);
  });
});

describe("stackExtent", () => {
  it("is the sum of each side, zero included", () => {
    expect(stackExtent([10, -4, null, 5, -1])).toEqual({ min: -5, max: 15 });
    expect(stackExtent([null, 3])).toEqual({ min: 0, max: 3 });
  });
});
