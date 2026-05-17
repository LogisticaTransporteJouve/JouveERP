import { describe, expect, it } from "vitest";

import { currentPeriod, isKnownSource, isPeriodFormat } from "./schema";

describe("isKnownSource", () => {
  it("true para fuentes conocidas", () => {
    expect(isKnownSource("transactions")).toBe(true);
    expect(isKnownSource("invoices")).toBe(true);
    expect(isKnownSource("receipts")).toBe(true);
    expect(isKnownSource("payment_orders")).toBe(true);
  });

  it("false para null o desconocidas", () => {
    expect(isKnownSource(null)).toBe(false);
    expect(isKnownSource("foo")).toBe(false);
    expect(isKnownSource("Invoices")).toBe(false);
  });
});

describe("isPeriodFormat", () => {
  it("acepta YYYY-MM válido", () => {
    expect(isPeriodFormat("2026-01")).toBe(true);
    expect(isPeriodFormat("2026-12")).toBe(true);
  });

  it("rechaza mes fuera de rango", () => {
    expect(isPeriodFormat("2026-00")).toBe(false);
    expect(isPeriodFormat("2026-13")).toBe(false);
  });

  it("rechaza formatos mal armados", () => {
    expect(isPeriodFormat("2026/01")).toBe(false);
    expect(isPeriodFormat("26-01")).toBe(false);
    expect(isPeriodFormat("2026-1")).toBe(false);
    expect(isPeriodFormat("")).toBe(false);
  });
});

describe("currentPeriod", () => {
  it("retorna formato YYYY-MM", () => {
    expect(isPeriodFormat(currentPeriod())).toBe(true);
  });
});
