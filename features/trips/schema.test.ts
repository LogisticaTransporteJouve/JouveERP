import { describe, expect, it } from "vitest";

import { TripCreateSchema, isTripStatus } from "./schema";

describe("TripCreateSchema", () => {
  it("accepts a minimal trip and normalizes empty optionals to null", () => {
    const r = TripCreateSchema.safeParse({
      trip_date: "2026-06-22",
      driver_id: "",
      vehicle_id: "",
      channel_id: "",
      origin: "",
      km: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.driver_id).toBeNull();
      expect(r.data.channel_id).toBeNull();
      expect(r.data.km).toBeNull();
      expect(r.data.status).toBe("planned");
    }
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

  it("rejects a negative revenue", () => {
    expect(
      TripCreateSchema.safeParse({ trip_date: "2026-06-22", revenue: "-1" })
        .success,
    ).toBe(false);
  });
});

describe("isTripStatus", () => {
  it("narrows known statuses", () => {
    expect(isTripStatus("planned")).toBe(true);
    expect(isTripStatus("nope")).toBe(false);
  });
});
