import { describe, expect, it } from "vitest";

import { FleetDocumentCreateSchema, isFleetDocKind } from "./schema";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const DRIVER_ID = "22222222-2222-4222-8222-222222222222";

describe("FleetDocumentCreateSchema", () => {
  it("accepts a vehicle-owned doc and normalizes empty optionals to null", () => {
    const r = FleetDocumentCreateSchema.safeParse({
      vehicle_id: VEHICLE_ID,
      driver_id: "",
      kind: "vtv",
      number: "",
      issued_at: "",
      expires_at: "2026-12-31",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.driver_id).toBeNull();
      expect(r.data.number).toBeNull();
      expect(r.data.issued_at).toBeNull();
    }
  });

  it("accepts a driver-owned doc", () => {
    const r = FleetDocumentCreateSchema.safeParse({
      driver_id: DRIVER_ID,
      kind: "licencia",
      expires_at: "2026-12-31",
    });
    expect(r.success).toBe(true);
  });

  it("rejects when both owners are set", () => {
    expect(
      FleetDocumentCreateSchema.safeParse({
        vehicle_id: VEHICLE_ID,
        driver_id: DRIVER_ID,
        kind: "vtv",
        expires_at: "2026-12-31",
      }).success,
    ).toBe(false);
  });

  it("rejects when neither owner is set", () => {
    expect(
      FleetDocumentCreateSchema.safeParse({
        kind: "vtv",
        expires_at: "2026-12-31",
      }).success,
    ).toBe(false);
  });

  it("requires expires_at", () => {
    expect(
      FleetDocumentCreateSchema.safeParse({
        vehicle_id: VEHICLE_ID,
        kind: "vtv",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(
      FleetDocumentCreateSchema.safeParse({
        vehicle_id: VEHICLE_ID,
        kind: "nope",
        expires_at: "2026-12-31",
      }).success,
    ).toBe(false);
  });
});

describe("isFleetDocKind", () => {
  it("narrows known kinds", () => {
    expect(isFleetDocKind("vtv")).toBe(true);
    expect(isFleetDocKind("nope")).toBe(false);
  });
});
