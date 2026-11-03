import { describe, expect, it } from "vitest";

import {
  CLIENT_TARIFF_CONCEPTS,
  CLIENT_TARIFF_CONCEPT_LABELS,
  CLIENT_TARIFF_UNITS,
  CLIENT_TARIFF_UNIT_LABELS,
  ClientTariffCreateSchema,
  ClientTariffUpdateSchema,
  UNITS_BY_CONCEPT,
  dailyPrice,
  isClientTariffConcept,
} from "./schema";

const client_id = "11111111-1111-4111-8111-111111111111";
const base = {
  client_id,
  concept: "storage",
  unit: "pallet_month",
  price: "3000",
  currency: "ARS",
  valid_from: "2026-11-01",
  valid_to: "",
  notes: "",
};

describe("ClientTariffCreateSchema", () => {
  it("coerces the price and stores empty optionals as null", () => {
    const r = ClientTariffCreateSchema.parse(base);
    expect(r.price).toBe(3000);
    expect(r.valid_to).toBeNull();
    expect(r.notes).toBeNull();
  });

  it("takes ARS when no currency comes", () => {
    expect(
      ClientTariffCreateSchema.parse({ ...base, currency: undefined }).currency,
    ).toBe("ARS");
  });

  it("refuses a unit the concept does not take", () => {
    const r = ClientTariffCreateSchema.safeParse({
      ...base,
      concept: "handling_in",
      unit: "pallet_month",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["unit"]);
  });

  it("refuses an end before the start", () => {
    const r = ClientTariffCreateSchema.safeParse({
      ...base,
      valid_to: "2026-10-31",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["valid_to"]);
  });

  it("accepts a one-day vigencia and a zero price", () => {
    expect(
      ClientTariffCreateSchema.safeParse({
        ...base,
        price: "0",
        valid_to: "2026-11-01",
      }).success,
    ).toBe(true);
  });

  it("refuses a negative price and an unknown currency", () => {
    expect(
      ClientTariffCreateSchema.safeParse({ ...base, price: "-1" }).success,
    ).toBe(false);
    expect(
      ClientTariffCreateSchema.safeParse({ ...base, currency: "EUR" }).success,
    ).toBe(false);
  });
});

describe("ClientTariffUpdateSchema", () => {
  it("needs the tariff id and runs the same checks", () => {
    const fields = { ...base, client_id: undefined };
    expect(
      ClientTariffUpdateSchema.safeParse({ ...fields, id: client_id }).success,
    ).toBe(true);
    expect(ClientTariffUpdateSchema.safeParse(fields).success).toBe(false);
    expect(
      ClientTariffUpdateSchema.safeParse({
        ...fields,
        id: client_id,
        concept: "storage",
        unit: "pallet",
      }).success,
    ).toBe(false);
  });
});

describe("catalog", () => {
  it("labels every concept and unit, and every concept takes a unit", () => {
    for (const c of CLIENT_TARIFF_CONCEPTS) {
      expect(CLIENT_TARIFF_CONCEPT_LABELS[c]).toBeTruthy();
      expect(UNITS_BY_CONCEPT[c].length).toBeGreaterThan(0);
    }
    for (const u of CLIENT_TARIFF_UNITS) {
      expect(CLIENT_TARIFF_UNIT_LABELS[u]).toBeTruthy();
    }
    expect(isClientTariffConcept("freight")).toBe(false);
  });

  it("prorates a monthly price /30 into a daily one", () => {
    expect(dailyPrice({ unit: "pallet_month", price: 3000 })).toBe(100);
    expect(dailyPrice({ unit: "pallet_day", price: 12 })).toBe(12);
  });
});
