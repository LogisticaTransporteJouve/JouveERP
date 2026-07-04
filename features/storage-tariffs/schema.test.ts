import { describe, expect, it } from "vitest";

import {
  StorageTariffCreateSchema,
  StorageTariffIncreaseSchema,
  isTariffPeriod,
  tariffVigencia,
} from "./schema";

describe("StorageTariffCreateSchema", () => {
  const base = {
    rate_per_pallet: 1500,
    period: "monthly",
    valid_from: "2026-07-01",
  };

  it("accepts a valid tariff and defaults period to monthly", () => {
    const r = StorageTariffCreateSchema.safeParse({
      rate_per_pallet: 1500,
      valid_from: "2026-07-01",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.period).toBe("monthly");
  });

  it("coerces rate_per_pallet and rejects non-positive", () => {
    expect(
      StorageTariffCreateSchema.safeParse({ ...base, rate_per_pallet: "1500" })
        .success,
    ).toBe(true);
    expect(
      StorageTariffCreateSchema.safeParse({ ...base, rate_per_pallet: 0 })
        .success,
    ).toBe(false);
  });

  it("normalizes empty optional fields to null", () => {
    const r = StorageTariffCreateSchema.safeParse({
      ...base,
      client_id: "",
      valid_to: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.client_id).toBeNull();
      expect(r.data.valid_to).toBeNull();
      expect(r.data.notes).toBeNull();
    }
  });

  it("rejects a valid_to before valid_from", () => {
    expect(
      StorageTariffCreateSchema.safeParse({
        ...base,
        valid_to: "2026-06-01",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown period", () => {
    expect(
      StorageTariffCreateSchema.safeParse({ ...base, period: "yearly" }).success,
    ).toBe(false);
  });
});

describe("guards", () => {
  it("narrows period", () => {
    expect(isTariffPeriod("daily")).toBe(true);
    expect(isTariffPeriod("monthly")).toBe(true);
    expect(isTariffPeriod("yearly")).toBe(false);
  });
});

describe("StorageTariffIncreaseSchema", () => {
  it("acepta porcentaje positivo y fecha", () => {
    const r = StorageTariffIncreaseSchema.safeParse({
      percent: 15,
      valid_from: "2026-08-01",
    });
    expect(r.success).toBe(true);
  });

  it("acepta bajas (porcentaje negativo > -100)", () => {
    expect(
      StorageTariffIncreaseSchema.safeParse({ percent: -10, valid_from: "2026-08-01" }).success,
    ).toBe(true);
  });

  it("rechaza 0, -100 y fechas inválidas", () => {
    expect(
      StorageTariffIncreaseSchema.safeParse({ percent: 0, valid_from: "2026-08-01" }).success,
    ).toBe(false);
    expect(
      StorageTariffIncreaseSchema.safeParse({ percent: -100, valid_from: "2026-08-01" }).success,
    ).toBe(false);
    expect(
      StorageTariffIncreaseSchema.safeParse({ percent: 10, valid_from: "01/08/2026" }).success,
    ).toBe(false);
  });
});

describe("tariffVigencia", () => {
  const T = { valid_from: "2026-07-01", valid_to: "2026-07-31" };
  it("vigente dentro del rango", () => {
    expect(tariffVigencia(T, "2026-07-15")).toBe("vigente");
  });
  it("vencida después de valid_to", () => {
    expect(tariffVigencia(T, "2026-08-01")).toBe("vencida");
  });
  it("futura antes de valid_from", () => {
    expect(tariffVigencia(T, "2026-06-30")).toBe("futura");
  });
  it("abierta (valid_to null) nunca vence", () => {
    expect(tariffVigencia({ valid_from: "2026-01-01", valid_to: null }, "2030-01-01")).toBe(
      "vigente",
    );
  });
});
