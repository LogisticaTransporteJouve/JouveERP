import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

type Filters = Record<string, unknown>;
type Row = Record<string, unknown> | null;

const EMP = "00000000-0000-4000-8000-000000000001";
let sacEntry: Row = null;
let sacPeriod: Row = null;

function rowFor(table: string, f: Filters): Row | Row[] {
  if (table === "employees") {
    return {
      id: EMP,
      hire_date: "2020-01-01",
      termination_date: "2026-12-28",
      base_salary: 1_000_000,
    };
  }
  if (table === "payroll_periods") {
    return f.kind === "sac" ? sacPeriod : { id: "mon-12", status: "draft" };
  }
  if (table === "v_employee_vacation_balances") return [];
  if (table === "payroll_entries") return { sueldo_neto: 1_000_000 };
  if (table === "v_payroll_entries_resolved") {
    return f.period_id === "sac-2" ? sacEntry : null;
  }
  return null;
}

function builder(table: string) {
  const filters: Filters = {};
  const b = {
    select: () => b,
    eq: (col: string, value: unknown) => {
      filters[col] = value;
      return b;
    },
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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => builder(table),
    // The 2.º semestre suggestion, prorated to Dec 28: 500000 × 181/184.
    rpc: async () => ({ data: 491_847.83, error: null }),
  }),
}));

const { getFinalSettlementAction } = await import("./final-settlement-actions");

beforeEach(() => {
  sacEntry = null;
  sacPeriod = null;
});

describe("getFinalSettlementAction", () => {
  it("suggests the whole proportional SAC without a SAC planilla", async () => {
    const res = await getFinalSettlementAction(EMP);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.sac_in_sac_planilla).toBe(0);
    expect(res.data.sac_amount).toBe(491_847.83);
  });

  it("does not pay the SAC again when the half's SAC planilla holds him", async () => {
    sacPeriod = { id: "sac-2" };
    sacEntry = { sueldo_neto: 500_000, extras_total: 0 };
    const res = await getFinalSettlementAction(EMP);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.sac_in_sac_planilla).toBe(500_000);
    expect(res.data.sac_amount).toBe(0);
  });

  it("adds only the rest when the SAC planilla pays less", async () => {
    sacPeriod = { id: "sac-2" };
    sacEntry = { sueldo_neto: 400_000, extras_total: 50_000 };
    const res = await getFinalSettlementAction(EMP);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.sac_amount).toBe(41_847.83);
  });
});
