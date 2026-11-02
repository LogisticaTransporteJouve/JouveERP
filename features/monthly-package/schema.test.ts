import { describe, expect, it } from "vitest";

import { MonthlyPackagePeriodSchema, needsAttention } from "./schema";

describe("MonthlyPackagePeriodSchema", () => {
  it("takes YYYY-MM only", () => {
    expect(MonthlyPackagePeriodSchema.safeParse("2026-10").success).toBe(true);
    expect(MonthlyPackagePeriodSchema.safeParse("2026-13").success).toBe(false);
    expect(MonthlyPackagePeriodSchema.safeParse("2026-10-01").success).toBe(
      false,
    );
  });
});

describe("needsAttention", () => {
  it("flags a positive count and an unread one, not zero", () => {
    expect(needsAttention(0)).toBe(false);
    expect(needsAttention(3)).toBe(true);
    expect(needsAttention(null)).toBe(true);
  });
});
