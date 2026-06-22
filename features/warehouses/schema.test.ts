import { describe, expect, it } from "vitest";

import { WarehouseCreateSchema } from "./schema";

describe("WarehouseCreateSchema", () => {
  it("accepts a minimal warehouse and normalizes empty optionals to null", () => {
    const r = WarehouseCreateSchema.safeParse({
      name: "Depósito Central",
      address: "",
      capacity_pallets: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.address).toBeNull();
      expect(r.data.capacity_pallets).toBeNull();
      expect(r.data.notes).toBeNull();
    }
  });

  it("requires a name", () => {
    expect(WarehouseCreateSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("coerces capacity_pallets to a non-negative integer", () => {
    const r = WarehouseCreateSchema.safeParse({
      name: "X",
      capacity_pallets: "120",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.capacity_pallets).toBe(120);
  });

  it("rejects a negative capacity_pallets", () => {
    expect(
      WarehouseCreateSchema.safeParse({ name: "X", capacity_pallets: -1 })
        .success,
    ).toBe(false);
  });
});
