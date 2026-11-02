import { describe, expect, it } from "vitest";

import { VehicleCreateSchema } from "./schema";

describe("VehicleCreateSchema", () => {
  it("accepts a minimal vehicle and normalizes empty optionals to null", () => {
    const r = VehicleCreateSchema.safeParse({
      patente: "AB123CD",
      vehicle_type: "camion",
      alias: "",
      brand: "",
      year: "",
      capacity_kg: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.alias).toBeNull();
      expect(r.data.brand).toBeNull();
      expect(r.data.year).toBeNull();
      expect(r.data.capacity_kg).toBeNull();
    }
  });

  it("requires a patente", () => {
    expect(
      VehicleCreateSchema.safeParse({ patente: "", vehicle_type: "camion" })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown vehicle_type", () => {
    expect(
      VehicleCreateSchema.safeParse({
        patente: "AB123CD",
        vehicle_type: "tank",
      }).success,
    ).toBe(false);
  });

  it("rejects a year out of range", () => {
    expect(
      VehicleCreateSchema.safeParse({
        patente: "AB123CD",
        vehicle_type: "camion",
        year: 1900,
      }).success,
    ).toBe(false);
  });
});

describe("fuel_card", () => {
  it("is stored without spaces or dashes, uppercase, or null when empty", () => {
    const parse = (fuel_card: string) =>
      VehicleCreateSchema.safeParse({
        patente: "AB123CD",
        vehicle_type: "camion",
        fuel_card,
      });
    const ok = parse("7069 0012-3456 ab");
    expect(ok.success && ok.data.fuel_card).toBe("706900123456AB");
    const empty = parse("");
    expect(empty.success && empty.data.fuel_card).toBeNull();
    expect(parse("12").success).toBe(false);
    expect(parse("7069/12").success).toBe(false);
  });
});
