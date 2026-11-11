import { describe, expect, it } from "vitest";

import {
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUSES,
  ShipmentCreateSchema,
  ShipmentUpdateSchema,
  ShipmentStatusChangeSchema,
  isShipmentStatus,
} from "./schema";

describe("ShipmentCreateSchema", () => {
  it("accepts an empty payload and normalizes empty optionals to null", () => {
    const r = ShipmentCreateSchema.safeParse({
      client_id: "",
      trip_id: "",
      destination: "",
      description: "",
      scheduled_date: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.client_id).toBeNull();
      expect(r.data.trip_id).toBeNull();
      expect(r.data.destination).toBeNull();
      expect(r.data.scheduled_date).toBeNull();
    }
  });

  it("keeps only the fields the form writes", () => {
    const r = ShipmentCreateSchema.parse({
      client_id: "11111111-1111-4111-8111-111111111111",
      destination: "Av. Corrientes 1234, CABA",
      scheduled_date: "2026-06-30",
      remito_number: "0001-1",
      freight_amount: "150000",
      cod_amount: "5000",
      origin: "Rosario",
      notes: "x",
    });
    expect(r).toEqual({
      client_id: "11111111-1111-4111-8111-111111111111",
      destination: "Av. Corrientes 1234, CABA",
      scheduled_date: "2026-06-30",
    });
  });

  it("rejects a non-uuid client_id", () => {
    expect(ShipmentCreateSchema.safeParse({ client_id: "abc" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed scheduled_date", () => {
    expect(
      ShipmentCreateSchema.safeParse({ scheduled_date: "30-06-2026" }).success,
    ).toBe(false);
  });
});

describe("ShipmentUpdateSchema", () => {
  it("does not carry the trip: it is assigned from the trip", () => {
    const r = ShipmentUpdateSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      trip_id: "22222222-2222-4222-8222-222222222222",
      description: "Pallets",
    });
    expect(r).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      description: "Pallets",
    });
  });
});

describe("ShipmentStatusChangeSchema", () => {
  it("accepts a valid status transition", () => {
    const r = ShipmentStatusChangeSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      status: "delivered",
      delivery_date: "2026-06-30",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(
      ShipmentStatusChangeSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        status: "lost",
      }).success,
    ).toBe(false);
  });
});

describe("isShipmentStatus", () => {
  it("is true for every declared status", () => {
    for (const s of SHIPMENT_STATUSES) expect(isShipmentStatus(s)).toBe(true);
  });

  it("is false for unknown values", () => {
    expect(isShipmentStatus("lost")).toBe(false);
    expect(isShipmentStatus(null)).toBe(false);
    expect(isShipmentStatus(42)).toBe(false);
  });

  it("has a label for every status", () => {
    for (const s of SHIPMENT_STATUSES) {
      expect(SHIPMENT_STATUS_LABELS[s]).toBeTruthy();
    }
  });
});
