import { describe, expect, it } from "vitest";

import { StorageInvoiceSchema } from "./schema";

const base = {
  client_id: "4f8c2a1e-9b3d-4c6a-8e2f-1a2b3c4d5e6f",
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  punto_venta: 3,
};

describe("StorageInvoiceSchema", () => {
  it("accepts a channel slug", () => {
    expect(
      StorageInvoiceSchema.safeParse({ ...base, channel_id: "jouve_fiscal" })
        .success,
    ).toBe(true);
  });

  it("requires a channel", () => {
    expect(
      StorageInvoiceSchema.safeParse({ ...base, channel_id: "" }).success,
    ).toBe(false);
  });
});
