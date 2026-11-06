import { describe, expect, it } from "vitest";

import {
  fiscalYearLabel,
  fiscalYearMonths,
  fiscalYearMonthsLabel,
  fiscalYearOf,
  fiscalYearPresets,
  fiscalYearStart,
  periodEnd,
  shortPeriodLabel,
} from "./fiscal-year";

describe("fiscal year starting in October (Jouve)", () => {
  const OCT = 10;

  it("names a fiscal year by the year it ends in", () => {
    expect(fiscalYearOf("2025-10", OCT)).toBe(2026);
    expect(fiscalYearOf("2026-09", OCT)).toBe(2026);
    expect(fiscalYearOf("2026-10", OCT)).toBe(2027);
    expect(fiscalYearLabel(2026, OCT)).toBe("2025/26");
  });

  it("starts on 1 October and ends on 30 September", () => {
    expect(fiscalYearStart("2026-03", OCT)).toBe("2025-10");
    expect(fiscalYearStart("2025-10", OCT)).toBe("2025-10");
    expect(fiscalYearStart("2026-09", OCT)).toBe("2025-10");
    expect(fiscalYearStart("2026-10", OCT)).toBe("2026-10");
    expect(fiscalYearStart("2026-11", OCT)).toBe("2026-10");
    const months = fiscalYearMonths(2026, OCT);
    expect(periodEnd(months[11]!)).toBe("2026-09-30");
  });

  it("lists its twelve months in order", () => {
    const months = fiscalYearMonths(2026, OCT);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-10");
    expect(months[2]).toBe("2025-12");
    expect(months[3]).toBe("2026-01");
    expect(months[11]).toBe("2026-09");
  });

  it("labels the months it spans", () => {
    expect(fiscalYearMonthsLabel(OCT)).toBe("oct–sep");
    expect(shortPeriodLabel("2025-10")).toBe("oct 2025");
  });

  it("offers the current fiscal year to date and the whole previous one", () => {
    expect(fiscalYearPresets("2026-11", OCT)).toEqual({
      current: { from: "2026-10", to: "2026-11", fy: 2027 },
      previous: { from: "2025-10", to: "2026-09", fy: 2026 },
    });
    expect(fiscalYearPresets("2026-09", OCT)).toEqual({
      current: { from: "2025-10", to: "2026-09", fy: 2026 },
      previous: { from: "2024-10", to: "2025-09", fy: 2025 },
    });
  });
});

describe("fiscal year as the calendar year", () => {
  it("is the calendar year, January to December", () => {
    expect(fiscalYearOf("2026-01", 1)).toBe(2026);
    expect(fiscalYearOf("2026-12", 1)).toBe(2026);
    expect(fiscalYearStart("2026-12", 1)).toBe("2026-01");
    expect(fiscalYearMonths(2026, 1)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
    expect(fiscalYearLabel(2026, 1)).toBe("2026");
    expect(fiscalYearMonthsLabel(1)).toBe("ene–dic");
  });
});

describe("fiscal year starting mid-year", () => {
  it("handles July to June", () => {
    expect(fiscalYearOf("2026-06", 7)).toBe(2026);
    expect(fiscalYearOf("2026-07", 7)).toBe(2027);
    expect(fiscalYearMonths(2027, 7)[0]).toBe("2026-07");
    expect(fiscalYearMonths(2027, 7)[11]).toBe("2027-06");
    expect(fiscalYearMonthsLabel(7)).toBe("jul–jun");
  });
});

describe("invalid input", () => {
  it("refuses a malformed period or start month", () => {
    expect(() => fiscalYearOf("2026-13", 10)).toThrow();
    expect(() => fiscalYearOf("2026-05", 0)).toThrow();
    expect(() => fiscalYearOf("2026-05", 13)).toThrow();
  });
});
