import { describe, expect, it } from "vitest";

import { fieldFormat, isNumericField, prettifyKey, toNumber } from "./rows";

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
