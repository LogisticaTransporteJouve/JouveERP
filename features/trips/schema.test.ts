import { describe, expect, it } from "vitest";

import {
  TripCreateSchema,
  TripCreateWithShipmentsSchema,
  TripUpdateSchema,
  isTripStatus,
} from "./schema";

describe("TripCreateSchema", () => {
  it("accepts a minimal trip and normalizes empty optionals to null", () => {
    const r = TripCreateSchema.safeParse({
      trip_date: "2026-06-22",
      driver_id: "",
      vehicle_id: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.driver_id).toBeNull();
      expect(r.data.vehicle_id).toBeNull();
      expect(r.data.status).toBe("planned");
    }
  });

  it("keeps only the fields the form writes", () => {
    const r = TripCreateSchema.parse({
      trip_date: "2026-06-22",
      status: "in_progress",
      channel_id: "jouve_fiscal",
      origin: "Rosario",
      km: "120",
      revenue: "1000",
      cost: "10",
      notes: "x",
    });
    expect(r).toEqual({ trip_date: "2026-06-22", status: "in_progress" });
  });

  it("requires a trip_date", () => {
    expect(TripCreateSchema.safeParse({ trip_date: "" }).success).toBe(false);
  });

  it("rejects a non-uuid driver_id", () => {
    expect(
      TripCreateSchema.safeParse({ trip_date: "2026-06-22", driver_id: "abc" })
        .success,
    ).toBe(false);
  });
});

describe("TripUpdateSchema", () => {
  it("drops the fields the form no longer writes", () => {
    const r = TripUpdateSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      status: "completed",
      revenue: "1000",
    });
    expect(r).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      status: "completed",
    });
  });
});

describe("isTripStatus", () => {
  it("narrows known statuses", () => {
    expect(isTripStatus("planned")).toBe(true);
    expect(isTripStatus("nope")).toBe(false);
  });
});

describe("TripCreateWithShipmentsSchema", () => {
  it("takes an optional Acompañante and the cargas to put on the trip", () => {
    const r = TripCreateWithShipmentsSchema.parse({
      trip_date: "2026-11-12",
      companion_employee_id: "",
    });
    expect(r.companion_employee_id).toBeNull();
    expect(r.shipment_ids).toEqual([]);
  });

  it("caps the cargas of one trip", () => {
    const ids = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(
      TripCreateWithShipmentsSchema.safeParse({
        trip_date: "2026-11-12",
        shipment_ids: ids,
      }).success,
    ).toBe(false);
  });
});
