import { describe, expect, it } from "vitest";

import {
  comprobanteLabel,
  computeLateInterest,
  inclusiveDays,
  lateInterestDescription,
} from "./lib/late-interest";
import {
  ClientRateSchema,
  GeneralRateSchema,
  IssueLateInterestSchema,
} from "./schema";

describe("computeLateInterest", () => {
  it("is simple interest at the monthly rate prorated /30 per day", () => {
    expect(
      computeLateInterest({
        openAmount: 10000,
        monthlyRate: 3,
        from: "2026-10-02",
        to: "2026-10-31",
      }),
    ).toEqual({ days: 30, interest: 300 });
  });

  it("counts both ends and rounds to cents", () => {
    expect(
      computeLateInterest({
        openAmount: 1000,
        monthlyRate: 2.5,
        from: "2026-10-01",
        to: "2026-10-07",
      }),
    ).toEqual({ days: 7, interest: 5.83 });
  });

  it("charges nothing for an empty period, no balance or no rate", () => {
    const base = {
      openAmount: 1000,
      monthlyRate: 3,
      from: "2026-10-10",
      to: "2026-10-10",
    };
    expect(computeLateInterest({ ...base, to: "2026-10-09" })).toEqual({
      days: 0,
      interest: 0,
    });
    expect(computeLateInterest({ ...base, openAmount: 0 }).interest).toBe(0);
    expect(computeLateInterest({ ...base, monthlyRate: 0 }).interest).toBe(0);
  });

  it("counts days across months", () => {
    expect(inclusiveDays("2026-02-27", "2026-03-02")).toBe(4);
  });
});

describe("labels", () => {
  it("names the comprobante and the period on the ND line", () => {
    const c = { kind: "factura", letter: "A", punto_venta: 2, numero: 123 };
    expect(comprobanteLabel(c)).toBe("FC A 0002-00000123");
    expect(
      lateInterestDescription({
        ...c,
        from: "2026-10-02",
        to: "2026-10-31",
        days: 30,
        monthlyRate: 3,
      }),
    ).toBe(
      "Intereses por mora s/ FC A 0002-00000123 del 02/10/2026 al 31/10/2026 (30 días al 3% mensual)",
    );
  });

  it("omits the letter of an internal comprobante", () => {
    expect(
      comprobanteLabel({ kind: "nd", letter: null, punto_venta: 1, numero: 9 }),
    ).toBe("ND 0001-00000009");
  });
});

describe("rate schemas", () => {
  it("issues only with a positive rate", () => {
    const base = {
      invoice_id: "00000000-0000-4000-8000-000000000001",
      as_of: "2026-10-31",
      punto_venta: "2",
    };
    expect(
      IssueLateInterestSchema.safeParse({ ...base, monthly_rate: "3" }).success,
    ).toBe(true);
    expect(
      IssueLateInterestSchema.safeParse({ ...base, monthly_rate: 0 }).success,
    ).toBe(false);
  });

  it("takes a rate between 0 and 100, or null to clear it", () => {
    expect(GeneralRateSchema.safeParse({ monthly_rate: null }).success).toBe(
      true,
    );
    expect(GeneralRateSchema.safeParse({ monthly_rate: 101 }).success).toBe(
      false,
    );
    expect(
      ClientRateSchema.safeParse({
        client_id: "00000000-0000-4000-8000-000000000001",
        monthly_rate: -1,
      }).success,
    ).toBe(false);
  });
});
