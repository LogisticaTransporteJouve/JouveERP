import { describe, expect, it } from "vitest";

import { StorageTariffCreateSchema, isTariffPeriod } from "./schema";

describe("StorageTariffCreateSchema", () => {
  const base = {
    rate_per_pallet: 1500,
    period: "monthly",
    valid_from: "2026-07-01",
  };

  it("accepts a valid tariff and defaults period to monthly", () => {
    const r = StorageTariffCreateSchema.safeParse({
      rate_per_pallet: 1500,
      valid_from: "2026-07-01",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.period).toBe("monthly");
  });

  it("coerces rate_per_pallet and rejects non-positive", () => {
    expect(
      StorageTariffCreateSchema.safeParse({ ...base, rate_per_pallet: "1500" })
        .success,
    ).toBe(true);
    expect(
      StorageTariffCreateSchema.safeParse({ ...base, rate_per_pallet: 0 })
        .success,
    ).toBe(false);
  });

  it("normalizes empty optional fields to null", () => {
    const r = StorageTariffCreateSchema.safeParse({
      ...base,
      client_id: "",
      valid_to: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.client_id).toBeNull();
      expect(r.data.valid_to).toBeNull();
      expect(r.data.notes).toBeNull();
    }
  });

  it("rejects a valid_to before valid_from", () => {
    expect(
      StorageTariffCreateSchema.safeParse({
        ...base,
        valid_to: "2026-06-01",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown period", () => {
    expect(
      StorageTariffCreateSchema.safeParse({ ...base, period: "yearly" }).success,
    ).toBe(false);
  });
});

describe("guards", () => {
  it("narrows period", () => {
    expect(isTariffPeriod("daily")).toBe(true);
    expect(isTariffPeriod("monthly")).toBe(true);
    expect(isTariffPeriod("yearly")).toBe(false);
  });
});
