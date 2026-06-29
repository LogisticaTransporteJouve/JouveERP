import { describe, expect, it } from "vitest";

import { addMonthsClamped, generateInstallments } from "./amortization";

describe("generateInstallments", () => {
  it("splits the principal into equal cuotas, last absorbs the remainder", () => {
    const r = generateInstallments(1000, 3, "2026-07-10");
    expect(r.map((i) => i.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(r.reduce((s, i) => s + i.amount, 0)).toBeCloseTo(1000, 2);
  });

  it("steps the due dates monthly from the first", () => {
    const r = generateInstallments(300, 3, "2026-07-10");
    expect(r.map((i) => i.due_date)).toEqual([
      "2026-07-10",
      "2026-08-10",
      "2026-09-10",
    ]);
    expect(r.map((i) => i.number)).toEqual([1, 2, 3]);
  });
});

describe("addMonthsClamped", () => {
  it("clamps the day to the target month length", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("keeps the day when it fits", () => {
    expect(addMonthsClamped("2026-03-15", 2)).toBe("2026-05-15");
  });
});
