import { describe, expect, it } from "vitest";

import {
  PaymentOrderCancelSchema,
  PaymentOrderCreateSchema,
  formatPaymentOrderNumber,
  isPaymentOrderCurrency,
  isPaymentOrderStatus,
} from "./schema";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("type guards", () => {
  it("isPaymentOrderStatus", () => {
    expect(isPaymentOrderStatus("issued")).toBe(true);
    expect(isPaymentOrderStatus("canceled")).toBe(true);
    expect(isPaymentOrderStatus("draft")).toBe(false);
    expect(isPaymentOrderStatus(null)).toBe(false);
  });

  it("isPaymentOrderCurrency", () => {
    expect(isPaymentOrderCurrency("ARS")).toBe(true);
    expect(isPaymentOrderCurrency("USD")).toBe(true);
    expect(isPaymentOrderCurrency("EUR")).toBe(false);
  });
});

describe("formatPaymentOrderNumber", () => {
  it("pads POS a 4 dígitos y número a 8", () => {
    expect(formatPaymentOrderNumber(1, 1)).toBe("OP0001-00000001");
    expect(formatPaymentOrderNumber(99, 12345)).toBe("OP0099-00012345");
    expect(formatPaymentOrderNumber(9999, 99999999)).toBe("OP9999-99999999");
  });
});

describe("PaymentOrderCancelSchema", () => {
  it("acepta id UUID", () => {
    expect(PaymentOrderCancelSchema.safeParse({ id: UUID }).success).toBe(true);
  });

  it("rechaza id no-UUID", () => {
    expect(PaymentOrderCancelSchema.safeParse({ id: "x" }).success).toBe(false);
  });
});

describe("PaymentOrderCreateSchema cotización", () => {
  const base = {
    channel_id: "jouve_fiscal",
    numero: 1,
    supplier_id: UUID,
    payment_date: "2026-10-31",
    total_amount: 80,
    currency: "USD" as const,
    notes: null,
    payment_lines: [
      { line_kind: "account" as const, account_id: UUID, amount: 80 },
    ],
    allocations: [],
  };

  it("requires a rate on a USD payment order", () => {
    const r = PaymentOrderCreateSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["cotizacion"]);
  });

  it("accepts a USD rate above 1 and rejects one below", () => {
    const ok = PaymentOrderCreateSchema.safeParse({
      ...base,
      cotizacion: 950.25,
    });
    const low = PaymentOrderCreateSchema.safeParse({
      ...base,
      cotizacion: 0.9,
    });
    expect(ok.success).toBe(true);
    expect(low.success).toBe(false);
  });

  it("does not ask an ARS payment order for a rate", () => {
    const r = PaymentOrderCreateSchema.safeParse({ ...base, currency: "ARS" });
    expect(r.success).toBe(true);
  });
});
