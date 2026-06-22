import { describe, expect, it } from "vitest";

import { MaintenanceCreateSchema, isMaintenanceKind } from "./schema";

describe("MaintenanceCreateSchema", () => {
  it("accepts a minimal record and normalizes empty optionals to null", () => {
    const r = MaintenanceCreateSchema.safeParse({
      vehicle_id: "11111111-1111-4111-8111-111111111111",
      service_date: "2026-06-22",
      description: "Cambio de aceite",
      cost: "",
      odometer_km: "",
      next_service_date: "",
      provider: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cost).toBeNull();
      expect(r.data.next_service_date).toBeNull();
      expect(r.data.provider).toBeNull();
      expect(r.data.kind).toBe("service");
    }
  });

  it("requires a vehicle_id", () => {
    expect(
      MaintenanceCreateSchema.safeParse({
        service_date: "2026-06-22",
        description: "x",
      }).success,
    ).toBe(false);
  });

  it("requires a service_date", () => {
    expect(
      MaintenanceCreateSchema.safeParse({
        vehicle_id: "11111111-1111-4111-8111-111111111111",
        service_date: "",
        description: "x",
      }).success,
    ).toBe(false);
  });

  it("requires a description", () => {
    expect(
      MaintenanceCreateSchema.safeParse({
        vehicle_id: "11111111-1111-4111-8111-111111111111",
        service_date: "2026-06-22",
        description: "",
      }).success,
    ).toBe(false);
  });

  it("rejects a negative cost", () => {
    expect(
      MaintenanceCreateSchema.safeParse({
        vehicle_id: "11111111-1111-4111-8111-111111111111",
        service_date: "2026-06-22",
        description: "x",
        cost: "-1",
      }).success,
    ).toBe(false);
  });
});

describe("isMaintenanceKind", () => {
  it("narrows known kinds", () => {
    expect(isMaintenanceKind("service")).toBe(true);
    expect(isMaintenanceKind("nope")).toBe(false);
  });
});
