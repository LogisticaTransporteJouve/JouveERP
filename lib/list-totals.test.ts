import { describe, expect, it } from "vitest";

import { grandTotal, isoCurrency, totalsByBucket } from "./list-totals";

const rows = [
  { bucket: "2026-10-31", currency: "ARS", documents: 2, total: 100 },
  { bucket: "2026-10-31", currency: "USD", documents: 1, total: 10 },
  { bucket: "2026-10-30", currency: "ARS", documents: 3, total: -20 },
];

describe("grandTotal", () => {
  it("sums documents and keeps one amount per currency, ARS first", () => {
    expect(grandTotal(rows)).toEqual({
      documents: 6,
      amounts: [
        { currency: "ARS", total: 80 },
        { currency: "USD", total: 10 },
      ],
    });
  });

  it("is empty with no rows", () => {
    expect(grandTotal([])).toEqual({ documents: 0, amounts: [] });
  });
});

describe("totalsByBucket", () => {
  it("summarizes each bucket and skips the ungrouped row", () => {
    const map = totalsByBucket([
      ...rows,
      { bucket: null, currency: "ARS", documents: 9, total: 9 },
    ]);
    expect(map.size).toBe(2);
    expect(map.get("2026-10-31")?.documents).toBe(3);
    expect(map.get("2026-10-30")?.amounts).toEqual([
      { currency: "ARS", total: -20 },
    ]);
  });
});

describe("isoCurrency", () => {
  it("maps AFIP codes", () => {
    expect(isoCurrency("PES")).toBe("ARS");
    expect(isoCurrency("DOL")).toBe("USD");
    expect(isoCurrency("USD")).toBe("USD");
  });
});
