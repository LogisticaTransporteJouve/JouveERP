import { describe, expect, it } from "vitest";

import {
  SupplierCreateSchema,
  SupplierToggleActiveSchema,
  SupplierUpdateSchema,
} from "./schema";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("SupplierCreateSchema", () => {
  it("acepta payload válido", () => {
    const res = SupplierCreateSchema.safeParse({
      cuit: "30-71463743-2",
      legal_name: "Proveedor SRL",
      iva_condition: "responsable_inscripto",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.cuit).toBe("30714637432");
  });

  it("rechaza CUIT corto", () => {
    expect(
      SupplierCreateSchema.safeParse({
        cuit: "123",
        legal_name: "Proveedor SRL",
        iva_condition: "responsable_inscripto",
      }).success,
    ).toBe(false);
  });

  it("rechaza legal_name vacío", () => {
    expect(
      SupplierCreateSchema.safeParse({
        cuit: "30714637432",
        legal_name: "",
        iva_condition: "responsable_inscripto",
      }).success,
    ).toBe(false);
  });

  it("rechaza email inválido", () => {
    expect(
      SupplierCreateSchema.safeParse({
        cuit: "30714637432",
        legal_name: "Proveedor SRL",
        iva_condition: "responsable_inscripto",
        email: "no-es-email",
      }).success,
    ).toBe(false);
  });

  it("normaliza email vacío a null", () => {
    const res = SupplierCreateSchema.safeParse({
      cuit: "30714637432",
      legal_name: "Proveedor SRL",
      iva_condition: "responsable_inscripto",
      email: "",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.email).toBe(null);
  });

  it("default_payment_term_days acepta vacío o número", () => {
    const a = SupplierCreateSchema.safeParse({
      cuit: "30714637432",
      legal_name: "Proveedor SRL",
      iva_condition: "responsable_inscripto",
      default_payment_term_days: "",
    });
    expect(a.success).toBe(true);
    if (a.success) expect(a.data.default_payment_term_days).toBe(null);

    const b = SupplierCreateSchema.safeParse({
      cuit: "30714637432",
      legal_name: "Proveedor SRL",
      iva_condition: "responsable_inscripto",
      default_payment_term_days: 30,
    });
    expect(b.success).toBe(true);
  });
});

describe("SupplierUpdateSchema", () => {
  it("requiere id UUID", () => {
    expect(
      SupplierUpdateSchema.safeParse({ id: "not-uuid", legal_name: "X" })
        .success,
    ).toBe(false);
  });

  it("acepta update parcial", () => {
    expect(
      SupplierUpdateSchema.safeParse({ id: UUID, legal_name: "Nuevo Nombre" })
        .success,
    ).toBe(true);
  });
});

describe("SupplierToggleActiveSchema", () => {
  it("acepta payload", () => {
    expect(
      SupplierToggleActiveSchema.safeParse({ id: UUID, is_active: false })
        .success,
    ).toBe(true);
  });
});
