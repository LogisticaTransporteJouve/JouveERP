import { describe, expect, it } from "vitest";

import {
  PaymentOrderCancelSchema,
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
