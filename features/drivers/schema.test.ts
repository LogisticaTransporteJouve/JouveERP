import { describe, expect, it } from "vitest";

import { DriverCreateSchema } from "./schema";

describe("DriverCreateSchema", () => {
  it("accepts a minimal driver and normalizes empty optionals to null", () => {
    const r = DriverCreateSchema.safeParse({
      full_name: "Juan Pérez",
      cuit: "",
      employee_id: "",
      phone: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cuit).toBeNull();
      expect(r.data.employee_id).toBeNull();
    }
  });

  it("requires a name", () => {
    expect(DriverCreateSchema.safeParse({ full_name: "" }).success).toBe(false);
  });

  it("rejects a non-uuid employee_id", () => {
    expect(
      DriverCreateSchema.safeParse({ full_name: "X", employee_id: "abc" })
        .success,
    ).toBe(false);
  });
});
