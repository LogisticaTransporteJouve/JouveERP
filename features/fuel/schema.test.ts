import { describe, expect, it } from "vitest";

import { FuelLoadCreateSchema } from "./schema";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

describe("FuelLoadCreateSchema", () => {
  it("accepts a minimal load and normalizes empty optionals to null", () => {
    const r = FuelLoadCreateSchema.safeParse({
      vehicle_id: VEHICLE_ID,
      load_date: "2026-06-22",
      liters: "50",
      amount: "100000",
      trip_id: "",
      odometer_km: "",
      station: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.trip_id).toBeNull();
      expect(r.data.odometer_km).toBeNull();
      expect(r.data.station).toBeNull();
      expect(r.data.liters).toBe(50);
      expect(r.data.amount).toBe(100000);
    }
  });

  it("requires a vehicle_id", () => {
    expect(
      FuelLoadCreateSchema.safeParse({
        load_date: "2026-06-22",
        liters: "50",
        amount: "100000",
      }).success,
    ).toBe(false);
  });

  it("requires a load_date", () => {
    expect(
      FuelLoadCreateSchema.safeParse({
        vehicle_id: VEHICLE_ID,
        load_date: "",
        liters: "50",
        amount: "100000",
      }).success,
    ).toBe(false);
  });

  it("rejects non-positive liters", () => {
    expect(
      FuelLoadCreateSchema.safeParse({
        vehicle_id: VEHICLE_ID,
        load_date: "2026-06-22",
        liters: "0",
        amount: "100000",
      }).success,
    ).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(
      FuelLoadCreateSchema.safeParse({
        vehicle_id: VEHICLE_ID,
        load_date: "2026-06-22",
        liters: "50",
        amount: "-1",
      }).success,
    ).toBe(false);
  });

  it("keeps an absent voucher undefined and an empty one null", () => {
    const base = {
      vehicle_id: VEHICLE_ID,
      load_date: "2026-06-22",
      liters: "50",
      amount: "100000",
    };
    const absent = FuelLoadCreateSchema.safeParse(base);
    expect(absent.success && absent.data.purchase_invoice_id).toBeUndefined();
    const cleared = FuelLoadCreateSchema.safeParse({
      ...base,
      purchase_invoice_id: "",
      transaction_id: VEHICLE_ID,
    });
    expect(cleared.success).toBe(true);
    if (cleared.success) {
      expect(cleared.data.purchase_invoice_id).toBeNull();
      expect(cleared.data.transaction_id).toBe(VEHICLE_ID);
    }
    expect(
      FuelLoadCreateSchema.safeParse({ ...base, transaction_id: "x" }).success,
    ).toBe(false);
  });
});
