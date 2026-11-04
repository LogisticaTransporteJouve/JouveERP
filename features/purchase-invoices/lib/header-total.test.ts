import { describe, expect, it } from "vitest";

import { amountsDiffer, followHeaderTotal, partsGapFix } from "./header-total";

describe("followHeaderTotal", () => {
  it("fills an empty total", () => {
    expect(followHeaderTotal(0, null, 121)).toBe(121);
  });

  it("follows a total that still equals the previous sum", () => {
    expect(followHeaderTotal(121, 121, 161)).toBe(161);
  });

  it("follows a derived sum that went down", () => {
    expect(followHeaderTotal(161, 161, 121)).toBe(121);
  });

  it("keeps a total the user typed", () => {
    expect(followHeaderTotal(130, 121, 161)).toBeNull();
  });

  it("keeps a stored total on the first calculation of an edit", () => {
    expect(followHeaderTotal(130, null, 121)).toBeNull();
  });
});

describe("amountsDiffer", () => {
  const loaded = { imp_neto: "1000", imp_iva: "210", imp_total: "1500" };

  it("is false for the same amounts, also written differently", () => {
    expect(
      amountsDiffer(
        { imp_neto: "1000.00", imp_iva: "210", imp_total: "1500" },
        loaded,
      ),
    ).toBe(false);
  });

  it("is true once one amount changes", () => {
    expect(amountsDiffer({ ...loaded, imp_neto: "1100" }, loaded)).toBe(true);
  });

  it("reads an empty field as 0", () => {
    expect(amountsDiffer({ imp_no_gravado: "" }, { imp_no_gravado: "0" })).toBe(
      false,
    );
  });
});

describe("partsGapFix", () => {
  const values = { imp_neto: "1.000", imp_no_gravado: "0" };

  it("moves a positive gap into no gravado on a fiscal A", () => {
    expect(partsGapFix(290, true, values)).toEqual({
      field: "imp_no_gravado",
      value: "290,00",
    });
  });

  it("adds it to the net otherwise", () => {
    expect(partsGapFix(290.5, false, values)).toEqual({
      field: "imp_neto",
      value: "1.290,50",
    });
  });

  it("offers nothing when the parts exceed the total or there is no gap", () => {
    expect(partsGapFix(-10, true, values)).toBeNull();
    expect(partsGapFix(null, true, values)).toBeNull();
  });
});
