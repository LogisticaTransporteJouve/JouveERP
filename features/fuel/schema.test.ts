import { describe, expect, it } from "vitest";

import {
  FuelImportConfirmSchema,
  FuelLoadCreateSchema,
  FuelLoadUpdateSchema,
} from "./schema";

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

  it("refuses a blank «Importe» instead of saving $0", () => {
    const r = FuelLoadCreateSchema.safeParse({
      vehicle_id: VEHICLE_ID,
      load_date: "2026-06-22",
      liters: "50",
      amount: "",
    });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe("Importe requerido.");
    expect(
      FuelLoadUpdateSchema.safeParse({ id: VEHICLE_ID, amount: "" }).success,
    ).toBe(false);
    expect(
      FuelLoadUpdateSchema.safeParse({ id: VEHICLE_ID, amount: "0" }).success,
    ).toBe(true);
    expect(FuelLoadUpdateSchema.safeParse({ id: VEHICLE_ID }).success).toBe(
      true,
    );
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

describe("FuelImportConfirmSchema", () => {
  const row = {
    vehicle_id: VEHICLE_ID,
    load_date: "2026-10-01",
    liters: 250.5,
    amount: 450900,
    odometer_km: null,
    station: "YPF",
    card: null,
    product: "Diesel",
    allow_duplicate: false,
  };
  const import_key = "9b2f3c1e-0d4a-4f5b-8c6d-7e8f9a0b1c2d";

  it("accepts confirmed rows", () => {
    expect(
      FuelImportConfirmSchema.safeParse({
        provider: "axion_card",
        import_key,
        rows: [row],
      }).success,
    ).toBe(true);
  });

  it("requires the import key that makes a resend idempotent", () => {
    expect(
      FuelImportConfirmSchema.safeParse({ provider: "axion_card", rows: [row] })
        .success,
    ).toBe(false);
  });

  it("rejects an empty import, zero liters and an unknown provider", () => {
    expect(
      FuelImportConfirmSchema.safeParse({
        provider: "axion_card",
        import_key,
        rows: [],
      }).success,
    ).toBe(false);
    expect(
      FuelImportConfirmSchema.safeParse({
        provider: "axion_card",
        import_key,
        rows: [{ ...row, liters: 0 }],
      }).success,
    ).toBe(false);
    expect(
      FuelImportConfirmSchema.safeParse({
        provider: "shell",
        import_key,
        rows: [row],
      }).success,
    ).toBe(false);
  });
});
