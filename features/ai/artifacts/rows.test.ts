import { describe, expect, it } from "vitest";

import {
  datasetsOf,
  fieldFormat,
  isNumericField,
  prettifyKey,
  resolveRows,
  toNumber,
} from "./rows";

describe("resolveRows", () => {
  const data = {
    totals: { a: 1 },
    byCostCenter: [{ center: "A", cost: 1 }],
    byMonth: [{ month: "2026-10", cost: 2 }],
    empty: [],
  };

  it("reads the first list by default and the named one with a dataset", () => {
    expect(resolveRows(data)).toEqual(data.byCostCenter);
    expect(resolveRows(data, "byMonth")).toEqual(data.byMonth);
  });

  it("returns nothing for a dataset that is missing, empty or not a list", () => {
    expect(resolveRows(data, "byClient")).toBeNull();
    expect(resolveRows(data, "empty")).toBeNull();
    expect(resolveRows(data, "totals")).toBeNull();
    expect(resolveRows([{ a: 1 }], "byMonth")).toBeNull();
    expect(datasetsOf(data)).toEqual(["byCostCenter", "byMonth"]);
  });
});

describe("fieldFormat", () => {
  it.each([
    ["margin_pct", "percent"],
    ["pct_change", "percent"],
    ["percent", "percent"],
    ["paid_usd", "usd"],
    ["amount_foreign", "usd"],
    ["usd_total", "usd"],
    ["total_clients", "count"],
    ["total_documents", "count"],
    ["total_groups", "count"],
    ["document_count", "count"],
    ["count", "count"],
    ["qty", "count"],
    ["cantidad", "count"],
    ["days_until_expiry", "count"],
    ["cost_center_code", "code"],
    ["check_number", "code"],
    ["numero", "code"],
    ["cuit", "code"],
    ["cbu", "code"],
    ["total_open", "money"],
    ["imp_total", "money"],
    ["cost", "money"],
    ["coefficient", "number"],
    ["trip_km", "km"],
    ["odometer_km", "km"],
    ["km", "km"],
    ["trips_without_km_count", "count"],
    ["cost_per_km_ars", "money"],
    ["revenue_per_km_ars", "money"],
    ["liters_per_100km", "number"],
    ["advances_ars", "money"],
    ["cash_generation_ars", "money"],
    ["advances_usd", "usd"],
  ])("%s reads as %s", (key, format) => {
    expect(fieldFormat(key)).toBe(format);
  });
});

describe("numbers and codes", () => {
  it("keeps digits with leading zeros as text", () => {
    expect(toNumber("0012")).toBeNull();
    expect(toNumber("0.5")).toBe(0.5);
    expect(toNumber("-1500.25")).toBe(-1500.25);
  });

  it("never treats a code column as numeric, even when it is all digits", () => {
    const rows = [{ cost_center_code: "101" }, { cost_center_code: "102" }];
    expect(isNumericField(rows, "cost_center_code")).toBe(false);
    expect(isNumericField([{ total: "10" }], "total")).toBe(true);
  });

  it("keeps default labels within the 60-character limit", () => {
    expect(prettifyKey("a".repeat(64))).toHaveLength(60);
  });
});
