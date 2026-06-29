import { describe, expect, it } from "vitest";

import {
  lastBilledEnd,
  overlapsBilled,
  suggestedStart,
  uncoveredGap,
} from "./continuity";

const runs = [
  { period_start: "2026-06-01", period_end: "2026-06-14" },
  { period_start: "2026-05-01", period_end: "2026-05-31" },
];

describe("continuity", () => {
  it("lastBilledEnd returns the latest end (null if none)", () => {
    expect(lastBilledEnd(runs)).toBe("2026-06-14");
    expect(lastBilledEnd([])).toBeNull();
  });

  it("suggestedStart is the day after the last billed end", () => {
    expect(suggestedStart(runs)).toBe("2026-06-15");
    expect(suggestedStart([])).toBeNull();
  });

  it("uncoveredGap flags days skipped after the last billed period", () => {
    // billed up to the 14th, starting on the 16th → the 15th is uncovered
    expect(uncoveredGap(runs, "2026-06-16")).toEqual({
      from: "2026-06-15",
      to: "2026-06-15",
    });
  });

  it("uncoveredGap is null when continuing seamlessly", () => {
    expect(uncoveredGap(runs, "2026-06-15")).toBeNull();
  });

  it("overlapsBilled catches a period already (partly) billed", () => {
    expect(overlapsBilled(runs, "2026-06-10", "2026-06-20")).toBe(true); // overlaps 1–14
    expect(overlapsBilled(runs, "2026-06-15", "2026-06-30")).toBe(false); // clean continuation
  });
});
