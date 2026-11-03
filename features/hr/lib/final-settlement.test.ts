import { describe, expect, it } from "vitest";

import { finalSettlement } from "./final-settlement";

describe("finalSettlement", () => {
  it("prorates the last month and adds pending plus proportional vacation", () => {
    // Hired 2020: 21 days for 2026; Jan 1 → Mar 15 is 74 days.
    const res = finalSettlement({
      terminationDate: "2026-03-15",
      hireDate: "2020-05-10",
      monthlySalary: 900_000,
      pendingVacationDays: 3,
      hasBalanceForTerminationYear: false,
    });
    expect(res.daysWorked).toBe(15);
    expect(res.proratedSalary).toBe(450_000);
    // 3 + 21 × 74 / 365 = 7.26 → 7.3
    expect(res.vacationDays).toBe(7.3);
    expect(res.vacationAmount).toBe(262_800);
  });

  it("counts the 31st as the 30th and skips the proportional once granted", () => {
    const res = finalSettlement({
      terminationDate: "2026-10-31",
      hireDate: "2024-02-01",
      monthlySalary: 600_000,
      pendingVacationDays: 14,
      hasBalanceForTerminationYear: true,
    });
    expect(res.daysWorked).toBe(30);
    expect(res.proratedSalary).toBe(600_000);
    expect(res.vacationDays).toBe(14);
    expect(res.vacationAmount).toBe(336_000);
  });

  it("starts the proportional at a hire date inside the year", () => {
    const res = finalSettlement({
      terminationDate: "2026-06-29",
      hireDate: "2026-03-31",
      monthlySalary: 0,
      pendingVacationDays: -2,
      hasBalanceForTerminationYear: false,
    });
    // 14 × 91 / 365 = 3.49 → 3.5; a negative balance is not deducted.
    expect(res.vacationDays).toBe(3.5);
    expect(res.vacationAmount).toBe(0);
  });
});
