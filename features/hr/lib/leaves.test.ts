import { describe, expect, it } from "vitest";

import {
  leaveDays,
  leaveDaysInRange,
  leaveWarnings,
  pendingVacationDays,
  vacationBalanceWarning,
  vacationStartWarning,
} from "./leaves";

const none = new Set<string>();

describe("leaveDays / leaveDaysInRange", () => {
  it("counts calendar days, both ends included", () => {
    expect(leaveDays("2026-12-07", "2026-12-20")).toBe(14);
    expect(leaveDays("2026-12-07", "2026-12-07")).toBe(1);
  });

  it("counts only the days inside the range", () => {
    const leave = { start_date: "2026-11-25", end_date: "2026-12-05" };
    expect(leaveDaysInRange(leave, "2026-12-01", "2026-12-31")).toBe(5);
    expect(leaveDaysInRange(leave, "2026-11-01", "2026-11-30")).toBe(6);
    expect(leaveDaysInRange(leave, "2027-01-01", "2027-01-31")).toBe(0);
  });
});

describe("vacationStartWarning (LCT art. 151)", () => {
  it("accepts a Monday", () => {
    expect(vacationStartWarning("2026-12-07", none)).toBeNull();
  });

  it("warns on any other weekday and names that week's Monday", () => {
    const w = vacationStartWarning("2026-12-09", none);
    expect(w).toContain("Empieza el miércoles 09-12-2026");
    expect(w).toContain("sería el lunes 07-12-2026");
  });

  it("warns on a weekend", () => {
    expect(vacationStartWarning("2026-12-12", none)).toContain("sábado");
  });

  it("accepts the next working day when the Monday is a holiday", () => {
    const holidays = new Set(["2026-11-23"]);
    expect(vacationStartWarning("2026-11-24", holidays)).toBeNull();
    expect(vacationStartWarning("2026-11-23", holidays)).toContain("feriado");
  });

  it("walks past consecutive holidays", () => {
    const holidays = new Set(["2026-11-23", "2026-11-24"]);
    expect(vacationStartWarning("2026-11-25", holidays)).toBeNull();
    expect(vacationStartWarning("2026-11-24", holidays)).not.toBeNull();
  });
});

describe("pendingVacationDays", () => {
  it("adds the current period and what is still positive in earlier open ones", () => {
    expect(
      pendingVacationDays(
        [
          { period_year: 2026, remaining_days: 10, status: "active" },
          { period_year: 2025, remaining_days: 4, status: "extended" },
          { period_year: 2024, remaining_days: -2, status: "active" },
          { period_year: 2023, remaining_days: 9, status: "expired" },
        ],
        2026,
      ),
    ).toBe(14);
  });

  it("is null, not zero, when no open balance is loaded", () => {
    expect(pendingVacationDays([], 2026)).toBeNull();
    expect(
      pendingVacationDays(
        [{ period_year: 2025, remaining_days: 3, status: "expired" }],
        2026,
      ),
    ).toBeNull();
  });
});

describe("vacationBalanceWarning", () => {
  it("warns when the leave takes more days than are pending", () => {
    expect(vacationBalanceWarning("2026-12-07", "2026-12-20", 10)).toBe(
      "La licencia es de 14 días y le quedan 10 días de vacaciones pendientes.",
    );
  });

  it("stays quiet within the balance", () => {
    expect(vacationBalanceWarning("2026-12-07", "2026-12-20", 14)).toBeNull();
  });

  it("says so when there is no balance to compare with", () => {
    expect(vacationBalanceWarning("2026-12-07", "2026-12-20", null)).toContain(
      "No tiene saldo",
    );
  });
});

describe("leaveWarnings", () => {
  const leave = {
    kind: "vacaciones",
    start_date: "2026-12-09",
    end_date: "2026-12-30",
  };

  it("gives both warnings for a vacation off Monday and over the balance", () => {
    expect(leaveWarnings(leave, { holidays: none, pending: 14 })).toHaveLength(
      2,
    );
  });

  it("skips the balance check when it could not be read", () => {
    expect(
      leaveWarnings(leave, { holidays: none, pending: undefined }),
    ).toHaveLength(1);
  });

  it("gives none while a date is empty", () => {
    expect(
      leaveWarnings(
        { ...leave, start_date: "" },
        { holidays: none, pending: 0 },
      ),
    ).toEqual([]);
  });

  it("gives none for other kinds", () => {
    expect(
      leaveWarnings(
        { ...leave, kind: "enfermedad" },
        { holidays: none, pending: 0 },
      ),
    ).toEqual([]);
  });
});
