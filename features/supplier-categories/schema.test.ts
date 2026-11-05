import { describe, expect, it } from "vitest";

import {
  SupplierCategoryCreateSchema,
  SupplierCategoryDeleteSchema,
} from "./schema";

describe("SupplierCategoryCreateSchema", () => {
  it("acepta un nombre y lo deja activo por defecto", () => {
    const res = SupplierCategoryCreateSchema.safeParse({ name: "Combustible" });
    expect(res.success && res.data).toEqual({
      name: "Combustible",
      is_active: true,
    });
  });

  it("acepta de 1 a 60 caracteres, recortados", () => {
    const one = SupplierCategoryCreateSchema.safeParse({ name: "  X  " });
    expect(one.success && one.data.name).toBe("X");
    expect(
      SupplierCategoryCreateSchema.safeParse({ name: "a".repeat(60) }).success,
    ).toBe(true);
    expect(
      SupplierCategoryCreateSchema.safeParse({ name: "a".repeat(61) }).success,
    ).toBe(false);
    expect(
      SupplierCategoryCreateSchema.safeParse({ name: "   " }).success,
    ).toBe(false);
  });
});

describe("SupplierCategoryDeleteSchema", () => {
  it("requiere UUID", () => {
    expect(SupplierCategoryDeleteSchema.safeParse({ id: "x" }).success).toBe(
      false,
    );
  });
});
