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

  it("rechaza un nombre sin letras ni números (no tendría slug)", () => {
    const res = SupplierCategoryCreateSchema.safeParse({ name: "$$" });
    expect(res.success).toBe(false);
    if (!res.success)
      expect(res.error.issues[0]?.message).toBe(
        "El nombre necesita al menos una letra o un número.",
      );
  });
});

describe("SupplierCategoryDeleteSchema", () => {
  it("requiere UUID", () => {
    expect(SupplierCategoryDeleteSchema.safeParse({ id: "x" }).success).toBe(
      false,
    );
  });
});
