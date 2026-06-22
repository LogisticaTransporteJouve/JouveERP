import { describe, expect, it } from "vitest";

import { ProductCreateSchema } from "./schema";

describe("ProductCreateSchema", () => {
  it("accepts a minimal product and normalizes empty optionals to null", () => {
    const r = ProductCreateSchema.safeParse({
      client_id: "11111111-1111-4111-8111-111111111111",
      name: "Caño PVC 110mm",
      sku: "",
      unit: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sku).toBeNull();
      expect(r.data.unit).toBeNull();
      expect(r.data.notes).toBeNull();
    }
  });

  it("requires a name", () => {
    expect(
      ProductCreateSchema.safeParse({
        client_id: "11111111-1111-4111-8111-111111111111",
        name: "",
      }).success,
    ).toBe(false);
  });

  it("requires a uuid client_id", () => {
    expect(
      ProductCreateSchema.safeParse({ client_id: "abc", name: "X" }).success,
    ).toBe(false);
  });
});
