import { describe, expect, it } from "vitest";

import {
  currentVacationPeriodYear,
  suggestedVacationDays,
  vacationPeriodWindow,
} from "./vacation-periods";

describe("currentVacationPeriodYear", () => {
  it("starts the period on October 1", () => {
    expect(currentVacationPeriodYear("2026-10-01")).toBe(2026);
    expect(currentVacationPeriodYear("2026-11-02")).toBe(2026);
  });

  it("keeps the previous period until September 30", () => {
    expect(currentVacationPeriodYear("2026-09-30")).toBe(2025);
    expect(currentVacationPeriodYear("2027-04-30")).toBe(2026);
  });
});

describe("vacationPeriodWindow", () => {
  it("runs from October 1 to April 30 of the next year", () => {
    expect(vacationPeriodWindow(2026)).toEqual({
      granted_at: "2026-10-01",
      expires_at: "2027-04-30",
    });
  });
});

describe("suggestedVacationDays", () => {
  it("follows LCT art. 150 by seniority on December 31", () => {
    expect(suggestedVacationDays("2024-03-01", 2026)).toBe(14);
    expect(suggestedVacationDays("2021-12-31", 2026)).toBe(21);
    expect(suggestedVacationDays("2016-01-15", 2026)).toBe(28);
    expect(suggestedVacationDays("2006-06-01", 2026)).toBe(35);
  });

  it("counts a hire on December 31 as a full year", () => {
    expect(suggestedVacationDays("2021-12-31", 2025)).toBe(14);
    expect(suggestedVacationDays("2021-12-31", 2026)).toBe(21);
  });
});
