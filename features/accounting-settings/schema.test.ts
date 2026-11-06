import { describe, expect, it } from "vitest";

import { UpdateAccountingSettingsSchema } from "./schema";

describe("UpdateAccountingSettingsSchema", () => {
  it("accepts January through December", () => {
    for (const month of [1, 10, 12]) {
      expect(
        UpdateAccountingSettingsSchema.safeParse({
          fiscalYearStartMonth: month,
        }).success,
      ).toBe(true);
    }
  });

  it("refuses a month outside 1-12 or a fraction", () => {
    for (const month of [0, 13, 2.5]) {
      expect(
        UpdateAccountingSettingsSchema.safeParse({
          fiscalYearStartMonth: month,
        }).success,
      ).toBe(false);
    }
  });
});
