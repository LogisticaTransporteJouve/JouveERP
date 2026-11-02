import { describe, expect, it } from "vitest";

import {
  fiscalYearLabel,
  fiscalYearMonths,
  fiscalYearOf,
  fiscalYearStart,
} from "./fiscal-year";

describe("fiscal year (October to September)", () => {
  it("names a fiscal year by the year it ends in", () => {
    expect(fiscalYearOf("2025-10")).toBe(2026);
    expect(fiscalYearOf("2026-09")).toBe(2026);
    expect(fiscalYearOf("2026-10")).toBe(2027);
    expect(fiscalYearLabel(2026)).toBe("2025/26");
  });

  it("starts in October", () => {
    expect(fiscalYearStart("2026-03")).toBe("2025-10");
    expect(fiscalYearStart("2026-10")).toBe("2026-10");
  });

  it("lists its twelve months in order", () => {
    const months = fiscalYearMonths(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-10");
    expect(months[2]).toBe("2025-12");
    expect(months[3]).toBe("2026-01");
    expect(months[11]).toBe("2026-09");
  });

  it("refuses a malformed period", () => {
    expect(() => fiscalYearOf("2026-13")).toThrow();
  });
});
