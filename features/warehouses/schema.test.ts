import { describe, expect, it } from "vitest";

import {
  StorageAreaCreateSchema,
  StorageAreaUpdateSchema,
  WarehouseCreateSchema,
} from "./schema";

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

describe("storage areas (roadmap 4.4)", () => {
  const W = "11111111-1111-4111-8111-111111111111";

  it("needs a warehouse and a name", () => {
    expect(
      StorageAreaCreateSchema.safeParse({ warehouse_id: W, name: "Frío" })
        .success,
    ).toBe(true);
    expect(
      StorageAreaCreateSchema.safeParse({ warehouse_id: W, name: " " }).success,
    ).toBe(false);
  });

  it("updates the active flag alone", () => {
    const r = StorageAreaUpdateSchema.safeParse({ id: W, is_active: false });
    expect(r.success && r.data).toEqual({ id: W, is_active: false });
  });
});
