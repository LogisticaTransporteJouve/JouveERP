import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

let roles: Role[] = [];
const rpc = vi.fn(async () => ({ data: [], error: null }));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

const { getPayrollSummaryAction, getVacationOverviewAction } =
  await import("./hr-reports-actions");

beforeEach(() => {
  roles = [];
  rpc.mockClear();
});

describe("payroll aggregates", () => {
  it("never reach the database for a role without hr:read", async () => {
    for (const role of ["operations", "warehouse", "driver"] as const) {
      roles = [role];
      const res = await getPayrollSummaryAction({
        fromPeriod: "2026-01",
        toPeriod: "2026-03",
      });
      expect(res.ok).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls the summary RPC with defaults for finance", async () => {
    roles = ["finance"];
    const res = await getPayrollSummaryAction({
      fromPeriod: "2026-01",
      toPeriod: "2026-03",
    });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("ai_payroll_summary", {
      p_from_period: "2026-01",
      p_to_period: "2026-03",
      p_group_by: "month",
      p_employee_id: undefined,
    });
  });

  it("rejects an inverted period range", async () => {
    roles = ["finance"];
    const res = await getPayrollSummaryAction({
      fromPeriod: "2026-05",
      toPeriod: "2026-03",
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets the vacation RPC apply its own defaults", async () => {
    roles = ["admin"];
    await getVacationOverviewAction({});
    expect(rpc).toHaveBeenCalledWith("ai_vacation_overview", {
      p_as_of: undefined,
      p_expiring_days: undefined,
    });
  });
});
