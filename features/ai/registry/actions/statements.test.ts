import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

const listLoansAction = vi.fn();

vi.mock("@/features/loans/actions/loans-actions", () => ({
  listLoansAction,
  getLoanAction: vi.fn(),
}));
vi.mock("@/features/balance/actions/statements-actions", () => ({
  getAccountTypeTotalsAction: vi.fn(),
  getCostCenterBreakdownAction: vi.fn(),
  getExpenseByCategoryAction: vi.fn(),
}));
vi.mock("@/features/exchange-rates/actions/exchange-rates-actions", () => ({
  getUsdRateForDateAction: vi.fn(),
  listExchangeRatesAction: vi.fn(),
}));
vi.mock("@/lib/fiscal-year-settings", () => ({
  readFiscalYearStartMonth: vi.fn(),
}));

const { getLoans } = await import("./statements");

const ctx = { userId: "u1", access: resolveAccess(["finance"]) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLoans", () => {
  it("keeps a savings plan's pending cuotas out of the debt", async () => {
    listLoansAction.mockResolvedValue({
      ok: true,
      data: [
        {
          kind: "prestamo",
          status: "active",
          currency: "ARS",
          pending_total: 1000,
        },
        {
          kind: "plan_ahorro",
          status: "active",
          currency: "ARS",
          pending_total: 500,
        },
      ],
    });
    const res = await getLoans.execute(ctx, {});
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toMatchObject({
      pendingByCurrency: { ARS: 1000 },
      savingsPlansPending: { ARS: 500 },
    });
  });
});
