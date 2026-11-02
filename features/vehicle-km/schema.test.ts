import { describe, expect, it } from "vitest";

import { KmReadingSaveSchema, needsKmReading } from "./schema";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";

describe("KmReadingSaveSchema", () => {
  const base = {
    vehicle_id: VEHICLE_ID,
    period: "2026-11",
    km: 120500.5,
    read_on: "2026-11-02",
  };

  it("accepts a reading and turns empty notes into null", () => {
    const r = KmReadingSaveSchema.safeParse({ ...base, notes: "  " });
    expect(r.success && r.data.notes).toBeNull();
  });

  it("rejects negative km and a malformed month", () => {
    expect(KmReadingSaveSchema.safeParse({ ...base, km: -1 }).success).toBe(
      false,
    );
    expect(
      KmReadingSaveSchema.safeParse({ ...base, period: "2026-13" }).success,
    ).toBe(false);
  });
});

describe("needsKmReading", () => {
  it("skips towed vehicles", () => {
    expect(needsKmReading("camion")).toBe(true);
    expect(needsKmReading("utilitario")).toBe(true);
    expect(needsKmReading("acoplado")).toBe(false);
    expect(needsKmReading("semi")).toBe(false);
  });
});
