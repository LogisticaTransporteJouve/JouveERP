import { describe, expect, it } from "vitest";

import { sameRetentions } from "./retentions";

const stored = {
  kind: "retencion",
  tax_type: "ganancias",
  jurisdiction: null,
  certificate_number: "A-1",
  certificate_date: "2026-10-01",
  amount: 1234.5,
  notes: null,
};

describe("sameRetentions", () => {
  it("matches the stored list sent back as the form sends it", () => {
    const sent = {
      ...stored,
      jurisdiction: "",
      certificate_number: " A-1 ",
      amount: "1234.50",
      notes: "  ",
    };
    expect(sameRetentions([stored], [sent])).toBe(true);
    expect(sameRetentions([], [])).toBe(true);
  });

  it("ignores the order", () => {
    const other = { ...stored, certificate_number: "B-2" };
    expect(sameRetentions([stored, other], [other, stored])).toBe(true);
  });

  it("refuses an added, removed or changed retention", () => {
    expect(sameRetentions([], [stored])).toBe(false);
    expect(sameRetentions([stored], [])).toBe(false);
    expect(sameRetentions([stored], [{ ...stored, amount: 1234.51 }])).toBe(
      false,
    );
    expect(sameRetentions([stored], [{ ...stored, tax_type: "iva" }])).toBe(
      false,
    );
  });
});
