import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const getPayrollSummaryAction = vi.fn();

vi.mock("@/features/hr/actions/hr-reports-actions", () => ({
  getAttendanceSummaryAction: vi.fn(),
  getDriverExtrasAction: vi.fn(),
  getLeavesSummaryAction: vi.fn(),
  getPayrollConceptsAction: vi.fn(),
  getPayrollSummaryAction,
  getVacationOverviewAction: vi.fn(),
}));

const { getPayrollSummary } = await import("./payroll");

const ctx = { userId: "u1", access: resolveAccess(["owner"]) };

// Total 1000: 500 paid fiscal, 500 paid internal, nothing left.
const row = {
  group_key: "2026-10",
  label: "2026-10",
  periods: 1,
  employees: 1,
  sueldo_neto: 1000,
  extras: 0,
  vacaciones: 0,
  viaticos: 0,
  deudas: 0,
  telefono: 0,
  total_a_pagar: 1000,
  paid: 500,
  saldo: 0,
  embargo: 0,
};

beforeEach(() => {
  getPayrollSummaryAction.mockReset();
  getPayrollSummaryAction.mockResolvedValue({ ok: true, data: [row] });
});

describe("getPayrollSummary", () => {
  it("shows what the other channels paid when scoped, so the figures tie", async () => {
    const res = await getPayrollSummary.execute(ctx, {
      fromPeriod: "2026-10",
      toPeriod: "2026-10",
      scope: "fiscal",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.data as { totals: unknown }).totals).toEqual({
      total_a_pagar: 1000,
      paid: 500,
      paid_other_channels: 500,
      saldo: 0,
    });
    expect(res.summary).toContain("pagado por los otros canales");
  });

  it("leaves it out without a scope", async () => {
    getPayrollSummaryAction.mockResolvedValue({
      ok: true,
      data: [{ ...row, paid: 1000 }],
    });
    const res = await getPayrollSummary.execute(ctx, {
      fromPeriod: "2026-10",
      toPeriod: "2026-10",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.data as { totals: unknown }).totals).toEqual({
      total_a_pagar: 1000,
      paid: 1000,
      saldo: 0,
    });
  });
});
