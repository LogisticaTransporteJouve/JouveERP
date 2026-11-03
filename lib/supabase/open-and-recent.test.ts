import { describe, expect, it } from "vitest";

import { mergeOpenAndRecent } from "./open-and-recent";

const row = (id: string, due_date: string) => ({ id, due_date });

describe("mergeOpenAndRecent", () => {
  it("keeps every open row and orders the result soonest due first", () => {
    const { rows, truncated } = mergeOpenAndRecent(
      [row("o2", "2026-12-01"), row("o1", "2026-11-15")],
      [row("s1", "2026-11-20"), row("s2", "2026-01-01")],
      5,
    );
    expect(rows.map((r) => r.id)).toEqual(["s2", "o1", "s1", "o2"]);
    expect(truncated).toBe(false);
  });

  it("drops the oldest settled rows past the cap and says so", () => {
    const { rows, truncated } = mergeOpenAndRecent(
      [row("o1", "2020-01-01")],
      [
        row("s3", "2026-03-01"),
        row("s2", "2026-02-01"),
        row("s1", "2026-01-01"),
      ],
      2,
    );
    expect(rows.map((r) => r.id)).toEqual(["o1", "s2", "s3"]);
    expect(truncated).toBe(true);
  });
});
