import { describe, expect, it } from "vitest";

import {
  InflationAdjustmentCreateSchema,
  InflationAdjustmentDeleteSchema,
} from "./schema";

describe("InflationAdjustmentCreateSchema", () => {
  it("acepta payload válido", () => {
    expect(
      InflationAdjustmentCreateSchema.safeParse({
        period: "2026-05",
        coefficient: 1.058,
      }).success,
    ).toBe(true);
  });

  it("rechaza period mal formado", () => {
    expect(
      InflationAdjustmentCreateSchema.safeParse({
        period: "2026/05",
        coefficient: 1.058,
      }).success,
    ).toBe(false);
  });

  it("rechaza coefficient negativo", () => {
    expect(
      InflationAdjustmentCreateSchema.safeParse({
        period: "2026-05",
        coefficient: -1,
      }).success,
    ).toBe(false);
  });
});

describe("InflationAdjustmentDeleteSchema", () => {
  it("requiere UUID", () => {
    expect(
      InflationAdjustmentDeleteSchema.safeParse({ id: "not-uuid" }).success,
    ).toBe(false);
  });
});
