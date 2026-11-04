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

  it("requires the cost when an invoice or a movement is linked", () => {
    const base = {
      vehicle_id: "11111111-1111-4111-8111-111111111111",
      service_date: "2026-06-22",
      description: "Service",
      cost: "",
    };
    const link = "22222222-2222-4222-8222-222222222222";
    for (const voucher of [
      { purchase_invoice_id: link },
      { transaction_id: link },
    ]) {
      const r = MaintenanceCreateSchema.safeParse({ ...base, ...voucher });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe(
        "Cargá el costo del comprobante vinculado.",
      );
    }
    expect(
      MaintenanceCreateSchema.safeParse({
        ...base,
        cost: "0",
        purchase_invoice_id: link,
      }).success,
    ).toBe(true);
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
