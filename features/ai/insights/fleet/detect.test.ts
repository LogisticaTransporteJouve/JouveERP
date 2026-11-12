import { describe, expect, it } from "vitest";

import { detectFleetDocExpiry, type FleetDocRow } from "./detect";

const TODAY = "2026-07-01";

const doc = (over: Partial<FleetDocRow>): FleetDocRow => ({
  id: "d1",
  expires_at: "2026-12-31",
  label: "ABC123 (vtv)",
  ...over,
});

describe("detectFleetDocExpiry", () => {
  it("returns nothing when all documents are far from expiring", () => {
    expect(
      detectFleetDocExpiry([doc({ expires_at: "2027-01-01" })], TODAY),
    ).toEqual([]);
  });

  it("flags critical when a document is already expired", () => {
    const out = detectFleetDocExpiry(
      [doc({ id: "a", expires_at: "2026-06-01" })],
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe("critical");
    expect(out[0]?.kind).toBe("fleet_doc_expiry");
    expect(out[0]?.metrics.expired).toBe(1);
    expect(out[0]?.source_refs).toContain("a");
  });

  it("flags warning when only expiring within the horizon", () => {
    const out = detectFleetDocExpiry(
      [doc({ id: "b", expires_at: "2026-07-15" })],
      TODAY,
    );
    expect(out[0]?.severity).toBe("warning");
    expect(out[0]?.metrics.expiring_soon).toBe(1);
  });
});
