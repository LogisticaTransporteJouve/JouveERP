import { describe, expect, it } from "vitest";

import { DriverCreateSchema } from "./schema";

describe("DriverCreateSchema", () => {
  it("accepts a minimal driver and normalizes empty optionals to null", () => {
    const r = DriverCreateSchema.safeParse({
      full_name: "Juan Pérez",
      cuit: "",
      phone: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cuit).toBeNull();
  });

  it("requires a name", () => {
    expect(DriverCreateSchema.safeParse({ full_name: "" }).success).toBe(false);
  });

  it("never takes an employee link: own drivers come only from HR", () => {
    const r = DriverCreateSchema.safeParse({
      full_name: "X",
      employee_id: "00000000-0000-4000-8000-000000000001",
    });
    expect(r.success && "employee_id" in r.data).toBe(false);
  });
});
