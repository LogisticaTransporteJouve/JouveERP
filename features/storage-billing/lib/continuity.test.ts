import { describe, expect, it } from "vitest";

import {
  billedRuns,
  lastBilledEnd,
  overlapsBilled,
  pendingRuns,
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

describe("billedRuns / pendingRuns", () => {
  const october = { period_start: "2026-10-01", period_end: "2026-10-31" };
  const claimed = [
    // Linked on the internal channel, and an older run with no channel.
    {
      ...october,
      id: "a",
      client_id: "c1",
      invoice_id: "i1",
      channel_id: "jouve_internal",
    },
    {
      ...october,
      id: "b",
      client_id: "c1",
      invoice_id: "i2",
      channel_id: null,
    },
    // A pending claim (its link lost, or still issuing).
    {
      ...october,
      id: "c",
      client_id: "c1",
      invoice_id: null,
      channel_id: "jouve_fiscal",
    },
    // Another client's.
    {
      ...october,
      id: "d",
      client_id: "c2",
      invoice_id: "i3",
      channel_id: "jouve_fiscal",
    },
  ];
  const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

  it("a pending claim does not bill its days, so the claim can relink or free them", () => {
    expect(ids(billedRuns(claimed, "c1", "jouve_fiscal"))).toEqual(["b"]);
    expect(
      overlapsBilled(
        billedRuns(claimed, "c1", "jouve_fiscal"),
        "2026-10-01",
        "2026-10-31",
      ),
    ).toBe(true); // through the channel-less run only
    expect(ids(pendingRuns(claimed, "c1", "jouve_fiscal"))).toEqual(["c"]);
  });

  it("the overlap is per channel, as on the server; a run with no channel counts on every one", () => {
    const fiscalOnly = claimed.filter((r) => r.id !== "b");
    expect(billedRuns(fiscalOnly, "c1", "jouve_fiscal")).toEqual([]);
    expect(ids(billedRuns(fiscalOnly, "c1", "jouve_internal"))).toEqual(["a"]);
    expect(pendingRuns(fiscalOnly, "c1", "jouve_internal")).toEqual([]);
  });

  it("with no channel chosen, every channel counts", () => {
    expect(ids(billedRuns(claimed, "c1", null))).toEqual(["a", "b"]);
    expect(ids(pendingRuns(claimed, "c1", null))).toEqual(["c"]);
  });
});
