import { describe, expect, it } from "vitest";

import {
  CostCenterCreateSchema,
  CostCenterDeleteSchema,
  RecategorizeExpenseSchema,
} from "./schema";

describe("RecategorizeExpenseSchema", () => {
  const ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

  it("needs the account or the center, and keeps null apart from omitted", () => {
    expect(
      RecategorizeExpenseSchema.safeParse({ source: "transactions", id: ID })
        .success,
    ).toBe(false);
    const cleared = RecategorizeExpenseSchema.safeParse({
      source: "purchase_invoices",
      id: ID,
      cost_center_id: null,
    });
    expect(cleared.success && cleared.data).toEqual({
      source: "purchase_invoices",
      id: ID,
      cost_center_id: null,
    });
  });

  it("only knows movements and purchases", () => {
    expect(
      RecategorizeExpenseSchema.safeParse({
        source: "invoices",
        id: ID,
        cost_center_id: ID,
      }).success,
    ).toBe(false);
  });
});

describe("CostCenterCreateSchema", () => {
  it("acepta payload válido", () => {
    expect(
      CostCenterCreateSchema.safeParse({
        code: "FLOTA_DZ",
        name: "Flota DZ",
        is_active: true,
      }).success,
    ).toBe(true);
  });

  it("rechaza code con minúsculas", () => {
    expect(
      CostCenterCreateSchema.safeParse({
        code: "flota_dz",
        name: "X",
        is_active: true,
      }).success,
    ).toBe(false);
  });

  it("rechaza name muy corto", () => {
    expect(
      CostCenterCreateSchema.safeParse({
        code: "X",
        name: "A",
        is_active: true,
      }).success,
    ).toBe(false);
  });
});

describe("CostCenterDeleteSchema", () => {
  it("requiere UUID", () => {
    expect(CostCenterDeleteSchema.safeParse({ id: "not-uuid" }).success).toBe(
      false,
    );
    expect(
      CostCenterDeleteSchema.safeParse({
        id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      }).success,
    ).toBe(true);
  });
});
