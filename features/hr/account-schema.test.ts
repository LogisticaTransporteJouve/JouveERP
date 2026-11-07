import { describe, expect, it } from "vitest";

import {
  ApplySalaryRaiseSchema,
  CreateDebtPlanSchema,
  RecordAccountCashSchema,
  debtPlanKind,
  isDebitKind,
  loanInstallments,
  movementSource,
  planInstallmentDue,
  raiseTargets,
  raisedSalary,
  tripExtrasLines,
  type DebtPlan,
  type TripForExtras,
} from "./account-schema";

const EMP = "00000000-0000-4000-8000-000000000001";
const ACC = "00000000-0000-4000-8000-000000000002";
const PLAN = "00000000-0000-4000-8000-000000000003";

describe("movements", () => {
  it("signs advances and charges as debts and the rest as credits", () => {
    expect(isDebitKind("advance")).toBe(true);
    expect(isDebitKind("charge")).toBe(true);
    expect(isDebitKind("payroll_discount")).toBe(false);
    expect(isDebitKind("payment")).toBe(false);
    expect(isDebitKind("forgiveness")).toBe(false);
  });

  it("tells each movement's owner apart", () => {
    const none = {
      transaction_id: null,
      purchase_invoice_id: null,
      payroll_entry_id: null,
      driver_settlement_id: null,
    };
    expect(movementSource({ ...none, kind: "charge" })).toBe("manual");
    expect(
      movementSource({ ...none, kind: "charge", driver_settlement_id: "s" }),
    ).toBe("settlement");
    expect(
      movementSource({ ...none, kind: "advance", transaction_id: "t" }),
    ).toBe("cash");
    expect(
      movementSource({ ...none, kind: "charge", purchase_invoice_id: "p" }),
    ).toBe("purchase");
    expect(
      movementSource({
        ...none,
        kind: "payroll_discount",
        payroll_entry_id: "e",
      }),
    ).toBe("payroll");
    expect(movementSource({ ...none, kind: "forgiveness" })).toBe(
      "forgiveness",
    );
  });
});

describe("RecordAccountCashSchema", () => {
  const base = {
    employee_id: EMP,
    account_id: ACC,
    channel_id: "jouve_internal",
    date: "2026-11-03",
    amount: "100000",
  };

  it("lets an advance open a plan with an installment up to the advance", () => {
    const ok = RecordAccountCashSchema.safeParse({
      ...base,
      kind: "advance",
      installment_amount: 25000,
    });
    expect(ok.success).toBe(true);
    const tooBig = RecordAccountCashSchema.safeParse({
      ...base,
      kind: "advance",
      installment_amount: 100001,
    });
    expect(tooBig.success).toBe(false);
  });

  it("credits a plan only with a payment", () => {
    expect(
      RecordAccountCashSchema.safeParse({
        ...base,
        kind: "payment",
        plan_id: PLAN,
      }).success,
    ).toBe(true);
    expect(
      RecordAccountCashSchema.safeParse({
        ...base,
        kind: "advance",
        plan_id: PLAN,
      }).success,
    ).toBe(false);
    expect(
      RecordAccountCashSchema.safeParse({
        ...base,
        kind: "payment",
        installment_amount: 1000,
      }).success,
    ).toBe(false);
  });

  it("rejects a zero amount", () => {
    expect(
      RecordAccountCashSchema.safeParse({ ...base, kind: "advance", amount: 0 })
        .success,
    ).toBe(false);
  });
});

describe("debt plans", () => {
  it("stores the month as its first day and keeps the installment within the total", () => {
    const parsed = CreateDebtPlanSchema.parse({
      employee_id: EMP,
      currency: "ARS",
      description: "Préstamo personal",
      total: 300000,
      installment_amount: 50000,
      start_month: "2026-12",
    });
    expect(parsed.start_month).toBe("2026-12-01");
    expect(parsed.creditor).toBe("empresa");
    expect(
      CreateDebtPlanSchema.safeParse({
        employee_id: EMP,
        currency: "ARS",
        description: "x",
        total: 100,
        installment_amount: 101,
        start_month: "2026-12",
      }).success,
    ).toBe(false);
  });

  const plan: Pick<
    DebtPlan,
    "status" | "currency" | "installment_amount" | "remaining" | "start_month"
  > = {
    status: "activo",
    currency: "ARS",
    installment_amount: 50000,
    remaining: 120000,
    start_month: "2026-11-01",
  };

  it("discounts the installment from its first month on, capped at what remains", () => {
    expect(planInstallmentDue(plan, 2026, 10)).toBe(0);
    expect(planInstallmentDue(plan, 2026, 11)).toBe(50000);
    expect(planInstallmentDue({ ...plan, remaining: 20000 }, 2027, 1)).toBe(
      20000,
    );
  });

  it("discounts nothing for a paused, cancelled, settled or USD plan", () => {
    expect(planInstallmentDue({ ...plan, status: "pausado" }, 2026, 11)).toBe(
      0,
    );
    expect(planInstallmentDue({ ...plan, status: "cancelado" }, 2026, 11)).toBe(
      0,
    );
    expect(planInstallmentDue({ ...plan, remaining: 0 }, 2026, 11)).toBe(0);
    expect(planInstallmentDue({ ...plan, currency: "USD" }, 2026, 11)).toBe(0);
  });
});

describe("adelanto vs préstamo", () => {
  it("a plan whose cuota covers the total is an adelanto", () => {
    expect(debtPlanKind({ total: 100000, installment_amount: 100000 })).toBe(
      "advance",
    );
    expect(debtPlanKind({ total: 300000, installment_amount: 100000 })).toBe(
      "loan",
    );
  });

  it("counts the cuotas of a préstamo, with a smaller last one", () => {
    expect(loanInstallments(300000, 100000)).toEqual({
      count: 3,
      last: 100000,
    });
    expect(loanInstallments(250000, 100000)).toEqual({ count: 3, last: 50000 });
    expect(loanInstallments(100000, 100000)).toBeNull();
  });
});

describe("salary raises", () => {
  const employees = [
    {
      id: "a",
      legal_name: "A",
      position: "Chofer",
      convenio: "Camioneros",
      base_salary: 1000000,
    },
    {
      id: "b",
      legal_name: "B",
      position: " chofer ",
      convenio: null,
      base_salary: 900000,
    },
    {
      id: "c",
      legal_name: "C",
      position: "Administrativo",
      convenio: "Comercio",
      base_salary: null,
    },
  ];

  it("filters by position or convenio, case- and space-insensitive, skipping who has no salary", () => {
    expect(raiseTargets(employees, "all", "").map((e) => e.id)).toEqual([
      "a",
      "b",
    ]);
    expect(
      raiseTargets(employees, "position", "CHOFER").map((e) => e.id),
    ).toEqual(["a", "b"]);
    expect(
      raiseTargets(employees, "convenio", "camioneros").map((e) => e.id),
    ).toEqual(["a"]);
    expect(raiseTargets(employees, "convenio", "comercio")).toEqual([]);
    expect(raiseTargets(employees, "position", " ")).toEqual([]);
  });

  it("rounds the raised salary to cents like apply_salary_raise", () => {
    expect(raisedSalary(1000000, 7.5)).toBe(1075000);
    expect(raisedSalary(123456.78, 3.33)).toBe(127567.89);
  });

  it("validates the percentage and the month", () => {
    const ok = ApplySalaryRaiseSchema.parse({
      employee_ids: [EMP],
      percentage: "10",
      effective_month: "2026-12",
    });
    expect(ok.effective_month).toBe("2026-12-01");
    expect(
      ApplySalaryRaiseSchema.safeParse({
        employee_ids: [EMP],
        percentage: 0,
        effective_month: "2026-12",
      }).success,
    ).toBe(false);
    expect(
      ApplySalaryRaiseSchema.safeParse({
        employee_ids: [],
        percentage: 5,
        effective_month: "2026-12",
      }).success,
    ).toBe(false);
  });
});

describe("trip extras", () => {
  const trips: TripForExtras[] = [
    {
      id: "1",
      trip_date: "2026-11-02",
      km: 120.5,
      origin: null,
      destination: null,
      unloads: 2,
    },
    {
      id: "2",
      trip_date: "2026-11-02",
      km: null,
      origin: null,
      destination: null,
      unloads: 1,
    },
    {
      id: "3",
      trip_date: "2026-11-05",
      km: 80,
      origin: null,
      destination: null,
      unloads: 0,
    },
  ];

  it("counts distinct trip days, km and unloadings times each rate", () => {
    const res = tripExtrasLines(
      trips,
      {
        trip_rate_per_day: 10000,
        trip_rate_per_km: 50,
        trip_rate_per_unload: 3000,
      },
      "11/2026",
    );
    expect(res).toMatchObject({ days: 2, km: 200.5, unloads: 3 });
    expect(res.lines.map((l) => [l.concept, l.amount])).toEqual([
      ["jornadas", 20000],
      ["km", 10025],
      ["descargas", 9000],
    ]);
    expect(res.lines[1]?.description).toBe("Viajes 11/2026: 200,5 km");
  });

  it("suggests nothing for a concept without a rate", () => {
    const res = tripExtrasLines(
      trips,
      {
        trip_rate_per_day: null,
        trip_rate_per_km: 0,
        trip_rate_per_unload: 3000,
      },
      "11/2026",
    );
    expect(res.lines.map((l) => l.concept)).toEqual(["descargas"]);
  });
});
