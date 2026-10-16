import { describe, expect, it } from "vitest";

import { arsEquivalent, isUsdCurrency, toArs } from "./fx";

describe("isUsdCurrency", () => {
  it("accepts AFIP's DOL and ISO USD only", () => {
    expect(isUsdCurrency("DOL")).toBe(true);
    expect(isUsdCurrency("USD")).toBe(true);
    expect(isUsdCurrency("PES")).toBe(false);
    expect(isUsdCurrency("ARS")).toBe(false);
    expect(isUsdCurrency(null)).toBe(false);
  });
});

describe("toArs", () => {
  it("converts dollars at the rate and passes pesos through", () => {
    expect(toArs(10, "DOL", 1000)).toBe(10_000);
    expect(toArs(10, "USD", 1000)).toBe(10_000);
    expect(toArs(10, "PES", 1000)).toBe(10);
    expect(toArs(10, "ARS", null)).toBe(10);
  });

  it("returns null for dollars without a rate", () => {
    expect(toArs(10, "USD", null)).toBeNull();
  });
});

describe("arsEquivalent", () => {
  it("adds dollars at the rate, rounded to cents", () => {
    expect(arsEquivalent(1000, 2.5, 1180.505)).toBe(3951.26);
  });

  it("is the peso amount when there are no dollars, even without a rate", () => {
    expect(arsEquivalent(1234.567, 0, null)).toBe(1234.57);
  });

  it("is null when there are dollars and no rate", () => {
    expect(arsEquivalent(1000, 1, null)).toBeNull();
  });
});
