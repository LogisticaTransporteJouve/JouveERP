import { describe, expect, it } from "vitest";

import {
  FreightTariffIncreaseSchema,
  FreightTariffLineInputSchema,
  lineChange,
  type FreightTariffVersion,
} from "./schema";

const version = (
  lines: { section: string | null; concept: string; price: number | null }[],
): FreightTariffVersion => ({
  id: "v",
  label: "Septiembre/Octubre 26",
  valid_from: "2026-09-01",
  increase_pct: null,
  notes: null,
  lines: lines.map((l, i) => ({
    id: String(i),
    percent: null,
    note: null,
    ...l,
  })),
});

describe("FreightTariffLineInputSchema", () => {
  it("takes a price, a percentage or only a note", () => {
    expect(
      FreightTariffLineInputSchema.safeParse({ concept: "1", price: 35330 })
        .success,
    ).toBe(true);
    expect(
      FreightTariffLineInputSchema.safeParse({ concept: "Perelli", percent: 5 })
        .success,
    ).toBe(true);
    expect(
      FreightTariffLineInputSchema.safeParse({
        concept: "Retiros",
        note: "Tarifa + $ 62.600",
      }).success,
    ).toBe(true);
  });

  it("refuses a line with both a price and a percentage, or no concept", () => {
    const both = FreightTariffLineInputSchema.safeParse({
      concept: "x",
      price: 10,
      percent: 5,
    });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.message).toMatch(/precio o porcentaje/);
    expect(
      FreightTariffLineInputSchema.safeParse({ concept: " ", price: 10 })
        .success,
    ).toBe(false);
  });

  it("refuses a percentage above 100", () => {
    expect(
      FreightTariffLineInputSchema.safeParse({ concept: "x", percent: 120 })
        .success,
    ).toBe(false);
  });
});

describe("FreightTariffIncreaseSchema", () => {
  const base = {
    list_ids: ["00000000-0000-4000-8000-000000000001"],
    pct: "7.5",
    label: "Enero/Febrero 27",
    valid_from: "2027-01-01",
    round_to: "10",
  };

  it("reads the percentage and the rounding as numbers", () => {
    const r = FreightTariffIncreaseSchema.parse(base);
    expect(r.pct).toBe(7.5);
    expect(r.round_to).toBe(10);
  });

  it("refuses another rounding and no tarifario", () => {
    expect(
      FreightTariffIncreaseSchema.safeParse({ ...base, round_to: "5" }).success,
    ).toBe(false);
    expect(
      FreightTariffIncreaseSchema.safeParse({ ...base, list_ids: [] }).success,
    ).toBe(false);
  });
});

describe("lineChange", () => {
  const previous = version([
    { section: "Bultos", concept: "1", price: 32000 },
    { section: "1 pallet", concept: "0 a 199 kg", price: 100000 },
  ]);

  it("compares a line with the same section and concept before", () => {
    expect(
      lineChange({ section: "Bultos", concept: "1", price: 35200 }, previous),
    ).toEqual({ previous: 32000, pct: 10 });
  });

  it("does not match a concept of another section", () => {
    expect(
      lineChange({ section: "2 pallets", concept: "1", price: 1 }, previous),
    ).toBeNull();
  });

  it("has nothing to compare without a previous period or a price", () => {
    expect(
      lineChange({ section: "Bultos", concept: "1", price: 1 }, undefined),
    ).toBeNull();
    expect(
      lineChange({ section: "Bultos", concept: "1", price: null }, previous),
    ).toBeNull();
  });
});
