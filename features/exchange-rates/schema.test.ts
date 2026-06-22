import { describe, expect, it } from "vitest";

import {
  ExchangeRateCreateSchema,
  convertUsdToArs,
  findRateForDate,
} from "./schema";

describe("ExchangeRateCreateSchema", () => {
  it("acepta una cotización válida", () => {
    expect(
      ExchangeRateCreateSchema.safeParse({
        rate_date: "2026-06-22",
        rate: 1180.5,
      }).success,
    ).toBe(true);
  });

  it("rechaza fecha mal formada", () => {
    expect(
      ExchangeRateCreateSchema.safeParse({ rate_date: "2026-6-2", rate: 1 })
        .success,
    ).toBe(false);
    expect(
      ExchangeRateCreateSchema.safeParse({ rate_date: "2026-13-01", rate: 1 })
        .success,
    ).toBe(false);
  });

  it("rechaza cotización no positiva", () => {
    expect(
      ExchangeRateCreateSchema.safeParse({ rate_date: "2026-06-22", rate: 0 })
        .success,
    ).toBe(false);
    expect(
      ExchangeRateCreateSchema.safeParse({ rate_date: "2026-06-22", rate: -5 })
        .success,
    ).toBe(false);
  });
});

describe("findRateForDate", () => {
  const rates = [
    { rate_date: "2026-06-20", rate: 1170 },
    { rate_date: "2026-06-18", rate: 1160 },
    { rate_date: "2026-06-22", rate: 1185 },
  ];

  it("devuelve la cotización exacta del día", () => {
    expect(findRateForDate(rates, "2026-06-20")).toBe(1170);
  });

  it("devuelve la anterior más cercana si no hay del día", () => {
    expect(findRateForDate(rates, "2026-06-21")).toBe(1170);
    expect(findRateForDate(rates, "2026-06-19")).toBe(1160);
  });

  it("devuelve null si no hay ninguna en o antes de la fecha", () => {
    expect(findRateForDate(rates, "2026-06-17")).toBeNull();
    expect(findRateForDate([], "2026-06-22")).toBeNull();
  });

  it("toma la más reciente cuando hay varias <= fecha", () => {
    expect(findRateForDate(rates, "2026-06-30")).toBe(1185);
  });

  it("coacciona rate string a number (numeric de Postgres)", () => {
    // Postgres numeric may arrive as a string; the JSON.parse simulates that row
    // without breaking the typing rule (no `as`).
    const stringRates: { rate_date: string; rate: number }[] = JSON.parse(
      '[{"rate_date":"2026-06-20","rate":"1170.500000"}]',
    );
    const result = findRateForDate(stringRates, "2026-06-22");
    expect(result).toBe(1170.5);
    expect(typeof result).toBe("number");
  });
});

describe("convertUsdToArs", () => {
  it("multiplica y redondea a 2 decimales", () => {
    expect(convertUsdToArs(100, 1180.5)).toBe(118050);
    expect(convertUsdToArs(33.33, 1000.005)).toBe(33330.17);
  });
});
