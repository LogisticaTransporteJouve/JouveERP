import { describe, expect, it } from "vitest";

import {
  IssuedCheckCreateSchema,
  IssuedCheckTransitionSchema,
  IssuedCheckUpdateSchema,
  isIssuedCheckCurrency,
  isIssuedCheckKind,
  isIssuedCheckStatus,
} from "./schema";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("type guards", () => {
  it("isIssuedCheckKind", () => {
    expect(isIssuedCheckKind("fisico")).toBe(true);
    expect(isIssuedCheckKind("echeq")).toBe(true);
    expect(isIssuedCheckKind("foo")).toBe(false);
    expect(isIssuedCheckKind(undefined)).toBe(false);
  });

  it("isIssuedCheckStatus", () => {
    expect(isIssuedCheckStatus("emitted")).toBe(true);
    expect(isIssuedCheckStatus("cashed")).toBe(true);
    expect(isIssuedCheckStatus("foo")).toBe(false);
  });

  it("isIssuedCheckCurrency", () => {
    expect(isIssuedCheckCurrency("ARS")).toBe(true);
    expect(isIssuedCheckCurrency("USD")).toBe(true);
    expect(isIssuedCheckCurrency("EUR")).toBe(false);
  });
});

describe("IssuedCheckCreateSchema", () => {
  const valid = {
    kind: "fisico" as const,
    check_number: "12345678",
    bank_name: "Galicia",
    issue_date: "2026-05-17",
    due_date: "2026-06-17",
    amount: 1000,
    currency: "ARS" as const,
    bank_account_id: UUID,
  };

  it("acepta payload válido", () => {
    expect(IssuedCheckCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("convierte string a number en amount", () => {
    const res = IssuedCheckCreateSchema.safeParse({
      ...valid,
      amount: "1.234,56",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.amount).toBe(1234.56);
  });

  it("rechaza amount <= 0", () => {
    expect(
      IssuedCheckCreateSchema.safeParse({ ...valid, amount: 0 }).success,
    ).toBe(false);
  });

  it("normaliza CUIT con guiones a 11 dígitos", () => {
    const res = IssuedCheckCreateSchema.safeParse({
      ...valid,
      beneficiary_cuit: "30-12345678-9",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.beneficiary_cuit).toBe("30123456789");
  });

  it("rechaza CUIT con menos dígitos", () => {
    expect(
      IssuedCheckCreateSchema.safeParse({
        ...valid,
        beneficiary_cuit: "12345",
      }).success,
    ).toBe(false);
  });

  it("rechaza fecha mal formada", () => {
    expect(
      IssuedCheckCreateSchema.safeParse({ ...valid, issue_date: "17/05/2026" })
        .success,
    ).toBe(false);
  });

  it("rechaza bank_account_id no-UUID", () => {
    expect(
      IssuedCheckCreateSchema.safeParse({
        ...valid,
        bank_account_id: "not-uuid",
      }).success,
    ).toBe(false);
  });

  it("acepta payment_order_id vacío como null", () => {
    const res = IssuedCheckCreateSchema.safeParse({
      ...valid,
      payment_order_id: "",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.payment_order_id).toBe(null);
  });
});

describe("IssuedCheckUpdateSchema", () => {
  it("requiere id UUID", () => {
    expect(
      IssuedCheckUpdateSchema.safeParse({ id: "x", check_number: "1" }).success,
    ).toBe(false);
  });

  it("permite update parcial", () => {
    expect(
      IssuedCheckUpdateSchema.safeParse({ id: UUID, notes: "Nota" }).success,
    ).toBe(true);
  });
});

describe("IssuedCheckTransitionSchema", () => {
  it("acepta cashed/rejected/cancelled", () => {
    for (const s of ["cashed", "rejected", "cancelled"] as const) {
      expect(
        IssuedCheckTransitionSchema.safeParse({ id: UUID, to_status: s })
          .success,
      ).toBe(true);
    }
  });

  it("rechaza estado fuera del rango", () => {
    expect(
      IssuedCheckTransitionSchema.safeParse({ id: UUID, to_status: "emitted" })
        .success,
    ).toBe(false);
  });
});
