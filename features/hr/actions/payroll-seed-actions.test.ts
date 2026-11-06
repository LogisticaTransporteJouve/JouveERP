import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

// Opening a planilla that already exists returns it without logging
// "período creado": only the call that created it is audited.

const logAudit = vi.fn();
let fake = recordingSupabase();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["admin"], []),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));

const { seedPayrollPeriodAction, seedSacPeriodAction } =
  await import("./payroll-actions");

const PERIOD = "00000000-0000-4000-8000-000000000001";

function answer(created: boolean) {
  fake = recordingSupabase(() => ({
    data: { period_id: PERIOD, created },
    error: null,
  }));
}

beforeEach(() => {
  logAudit.mockClear();
});

describe("seedPayrollPeriodAction", () => {
  it("audits the planilla it created", async () => {
    answer(true);
    const res = await seedPayrollPeriodAction({ year: 2026, month: 11 });
    expect(res).toEqual({ ok: true, data: { period_id: PERIOD } });
    expect(fake.calls[0]).toMatchObject({
      table: "create_payroll_period",
      op: "rpc",
      payload: { p_year: 2026, p_month: 11 },
    });
    expect(logAudit).toHaveBeenCalledWith(
      "payroll.period_created",
      "u1",
      { year: 2026, month: 11 },
      PERIOD,
    );
  });

  it("returns an existing planilla without auditing a creation", async () => {
    answer(false);
    const res = await seedPayrollPeriodAction({ year: 2026, month: 11 });
    expect(res).toEqual({ ok: true, data: { period_id: PERIOD } });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("seedSacPeriodAction", () => {
  it("audits the SAC period it created", async () => {
    answer(true);
    const res = await seedSacPeriodAction({ year: 2026, half: 2 });
    expect(res).toEqual({ ok: true, data: { period_id: PERIOD } });
    expect(logAudit).toHaveBeenCalledWith(
      "payroll.sac_period_created",
      "u1",
      { year: 2026, half: 2 },
      PERIOD,
    );
  });

  it("returns an existing SAC period without auditing a creation", async () => {
    answer(false);
    const res = await seedSacPeriodAction({ year: 2026, half: 2 });
    expect(res).toEqual({ ok: true, data: { period_id: PERIOD } });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
