import { describe, expect, it } from "vitest";

import {
  SupplierCategoryCreateSchema,
  SupplierCategoryDeleteSchema,
  slugFromName,
} from "./schema";

describe("slugFromName", () => {
  it("normaliza acentos y espacios", () => {
    expect(slugFromName("Combustible Líquido")).toBe("combustible_liquido");
  });
  it("prefija con x si arranca con número", () => {
    expect(slugFromName("123 cat")).toBe("x23_cat");
  });
});

describe("SupplierCategoryCreateSchema", () => {
  it("acepta nombre + slug autogenerado", () => {
    const res = SupplierCategoryCreateSchema.safeParse({
      name: "Combustible",
      is_active: true,
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.slug).toBe("combustible");
  });

  it("respeta slug explícito", () => {
    const res = SupplierCategoryCreateSchema.safeParse({
      name: "Combustible",
      slug: "fuel",
      is_active: true,
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.slug).toBe("fuel");
  });

  it("rechaza name corto", () => {
    expect(
      SupplierCategoryCreateSchema.safeParse({
        name: "X",
        is_active: true,
      }).success,
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
