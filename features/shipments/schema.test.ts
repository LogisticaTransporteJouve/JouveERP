import { describe, expect, it } from "vitest";

import {
  FreightInvoiceSchema,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUSES,
  ShipmentCreateSchema,
  ShipmentStatusChangeSchema,
  isShipmentStatus,
} from "./schema";

describe("ShipmentCreateSchema", () => {
  it("accepts an empty payload and normalizes empty optionals to null", () => {
    const r = ShipmentCreateSchema.safeParse({
      client_id: "",
      trip_id: "",
      channel_id: "",
      origin: "",
      destination: "",
      description: "",
      scheduled_date: "",
      freight_amount: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.client_id).toBeNull();
      expect(r.data.trip_id).toBeNull();
      expect(r.data.channel_id).toBeNull();
      expect(r.data.freight_amount).toBeNull();
      expect(r.data.scheduled_date).toBeNull();
    }
  });

  it("accepts a populated shipment", () => {
    const r = ShipmentCreateSchema.safeParse({
      client_id: "11111111-1111-4111-8111-111111111111",
      origin: "Rosario",
      destination: "CABA",
      scheduled_date: "2026-06-30",
      freight_amount: "150000",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.freight_amount).toBe(150000);
      expect(r.data.origin).toBe("Rosario");
    }
  });

  it("rejects a non-uuid client_id", () => {
    expect(
      ShipmentCreateSchema.safeParse({ client_id: "abc" }).success,
    ).toBe(false);
  });

  it("rejects a negative freight_amount", () => {
    expect(
      ShipmentCreateSchema.safeParse({ freight_amount: "-1" }).success,
    ).toBe(false);
  });

  it("rejects a malformed scheduled_date", () => {
    expect(
      ShipmentCreateSchema.safeParse({ scheduled_date: "30-06-2026" }).success,
    ).toBe(false);
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

describe("FreightInvoiceSchema", () => {
  it("accepts a valid freight-invoice request", () => {
    const r = FreightInvoiceSchema.safeParse({
      shipmentId: "11111111-1111-4111-8111-111111111111",
      channel_id: "dz_fiscal",
      punto_venta: 3,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.punto_venta).toBe(3);
  });

  it("requires a non-empty channel_id", () => {
    expect(
      FreightInvoiceSchema.safeParse({
        shipmentId: "11111111-1111-4111-8111-111111111111",
        channel_id: "",
        punto_venta: 3,
      }).success,
    ).toBe(false);
  });

  it("rejects punto_venta out of range", () => {
    expect(
      FreightInvoiceSchema.safeParse({
        shipmentId: "11111111-1111-4111-8111-111111111111",
        channel_id: "dz_fiscal",
        punto_venta: 0,
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
