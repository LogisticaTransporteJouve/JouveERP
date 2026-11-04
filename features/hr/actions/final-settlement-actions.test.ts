import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

type Filters = Record<string, unknown>;
type Row = Record<string, unknown> | null;

const EMP = "00000000-0000-4000-8000-000000000001";
let sacEntry: Row = null;
let sacPeriod: Row = null;
let terminationDate = "2026-12-28";
// What employee_salary_for_month returns for the leaving month.
let salaryForMonth: number | null = 1_000_000;
// payroll_entries.sueldo_neto by period id.
let entries: Record<string, number> = {};
let monthlyPeriods: Record<string, string> = {};

function rowFor(table: string, f: Filters): Row | Row[] {
  if (table === "employees") {
    return {
      id: EMP,
      hire_date: "2020-01-01",
      termination_date: terminationDate,
    };
  }
  if (table === "payroll_periods") {
    if (f.kind === "sac") return sacPeriod;
    const id = monthlyPeriods[`${String(f.year)}-${String(f.month)}`];
    return id ? { id, status: "draft" } : null;
  }
  if (table === "v_employee_vacation_balances") return [];
  if (table === "payroll_entries") {
    const value = entries[String(f.period_id)];
    return value === undefined ? null : { sueldo_neto: value };
  }
  if (table === "v_payroll_entries_resolved") {
    return f.period_id === "sac-2" ? sacEntry : null;
  }
  return null;
}

function builder(table: string) {
  const filters: Filters = {};
  let upserted: Row = null;
  const b = {
    select: () => b,
    eq: (col: string, value: unknown) => {
      filters[col] = value;
      return b;
    },
    like: () => b,
    delete: () => b,
    insert: () => b,
    upsert: (row: Record<string, unknown>) => {
      entries[String(row.period_id)] = Number(row.sueldo_neto);
      upserted = { id: `entry-${String(row.period_id)}` };
      return b;
    },
    single: async () => ({ data: upserted, error: null }),
    maybeSingle: async () => ({ data: rowFor(table, filters), error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: rowFor(table, filters), error: null }),
  };
  return b;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"], []),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: async () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "employee_salary_for_month") {
        return { data: salaryForMonth, error: null };
      }
      if (fn === "seed_payroll_period") {
        const key = `${String(args.p_year)}-${String(args.p_month)}`;
        monthlyPeriods[key] ??= `mon-${key}`;
        return { data: monthlyPeriods[key], error: null };
      }
      // The 2.º semestre suggestion, prorated to Dec 28: 500000 × 181/184.
      return { data: 491_847.83, error: null };
    },
  }),
}));

const { applyFinalSettlementAction, getFinalSettlementAction } =
  await import("./final-settlement-actions");

beforeEach(() => {
  sacEntry = null;
  sacPeriod = null;
  terminationDate = "2026-12-28";
  salaryForMonth = 1_000_000;
  entries = { "mon-2026-12": 1_000_000 };
  monthlyPeriods = { "2026-12": "mon-2026-12" };
});

async function suggestion() {
  const res = await getFinalSettlementAction(EMP);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

async function applySuggestion() {
  const s = await suggestion();
  const res = await applyFinalSettlementAction({
    employee_id: EMP,
    prorated_salary: s.prorated_salary,
    vacation_days: s.vacation_days,
    vacation_amount: s.vacation_amount,
    sac_amount: s.sac_amount,
  });
  if (!res.ok) throw new Error(res.error);
}

describe("getFinalSettlementAction", () => {
  it("suggests the whole proportional SAC without a SAC planilla", async () => {
    const s = await suggestion();
    expect(s.sac_in_sac_planilla).toBe(0);
    expect(s.sac_amount).toBe(491_847.83);
  });

  it("does not pay the SAC again when the half's SAC planilla holds him", async () => {
    sacPeriod = { id: "sac-2" };
    sacEntry = { sueldo_neto: 500_000, extras_total: 0 };
    const s = await suggestion();
    expect(s.sac_in_sac_planilla).toBe(500_000);
    expect(s.sac_amount).toBe(0);
  });

  it("adds only the rest when the SAC planilla pays less", async () => {
    sacPeriod = { id: "sac-2" };
    sacEntry = { sueldo_neto: 400_000, extras_total: 50_000 };
    const s = await suggestion();
    expect(s.sac_amount).toBe(41_847.83);
  });

  it("takes the salary in force in the leaving month", async () => {
    salaryForMonth = 900_000;
    const s = await suggestion();
    expect(s.monthly_salary).toBe(900_000);
  });
});

describe("final settlement without a base salary", () => {
  beforeEach(() => {
    terminationDate = "2026-11-15";
    salaryForMonth = null;
    monthlyPeriods = { "2026-10": "mon-2026-10", "2026-11": "mon-2026-11" };
    entries = { "mon-2026-10": 300_000, "mon-2026-11": 300_000 };
  });

  it("reads the previous month's line, not the one it overwrites", async () => {
    entries["mon-2026-11"] = 123;
    const s = await suggestion();
    expect(s.monthly_salary).toBe(300_000);
    expect(s.prorated_salary).toBe(150_000);
  });

  it("gives the same figures when applied again", async () => {
    await applySuggestion();
    expect(entries["mon-2026-11"]).toBe(150_000);
    const first = await suggestion();
    await applySuggestion();
    expect(entries["mon-2026-11"]).toBe(150_000);
    expect(await suggestion()).toEqual(first);
    expect(first.monthly_salary).toBe(300_000);
    expect(first.vacation_amount).toBe(
      Math.round((300_000 / 25) * first.vacation_days * 100) / 100,
    );
  });

  it("looks back to December for a January leave", async () => {
    terminationDate = "2027-01-10";
    monthlyPeriods = { "2026-12": "mon-2026-12" };
    entries = { "mon-2026-12": 600_000 };
    const s = await suggestion();
    expect(s.monthly_salary).toBe(600_000);
  });

  it("suggests no salary when neither source has one", async () => {
    monthlyPeriods = {};
    entries = {};
    const s = await suggestion();
    expect(s.monthly_salary).toBe(0);
  });
});
