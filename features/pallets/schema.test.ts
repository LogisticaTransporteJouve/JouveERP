import { describe, expect, it } from "vitest";

import { PalletCreateSchema, isPalletStatus } from "./schema";

const WAREHOUSE_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

describe("PalletCreateSchema", () => {
  it("accepts a minimal pallet and normalizes empty optionals to null", () => {
    const r = PalletCreateSchema.safeParse({
      warehouse_id: WAREHOUSE_ID,
      client_id: CLIENT_ID,
      code: "P-001",
      entry_date: "2026-01-15",
      product_id: "",
      quantity: "",
      exit_date: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.product_id).toBeNull();
      expect(r.data.quantity).toBeNull();
      expect(r.data.exit_date).toBeNull();
      expect(r.data.status).toBe("en_deposito");
    }
  });

  it("requires warehouse, client, code and entry_date", () => {
    expect(PalletCreateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a negative quantity", () => {
    expect(
      PalletCreateSchema.safeParse({
        warehouse_id: WAREHOUSE_ID,
        client_id: CLIENT_ID,
        code: "P-001",
        entry_date: "2026-01-15",
        quantity: -1,
      }).success,
    ).toBe(false);
  });
});

describe("isPalletStatus", () => {
  it("accepts known statuses and rejects unknown ones", () => {
    expect(isPalletStatus("en_deposito")).toBe(true);
    expect(isPalletStatus("despachado")).toBe(true);
    expect(isPalletStatus("perdido")).toBe(false);
    expect(isPalletStatus(null)).toBe(false);
  });
});
