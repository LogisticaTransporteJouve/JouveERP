import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/balance/actions/statements-actions", () => ({
  getAccountTypeTotalsAction: vi.fn(),
  getCostCenterBreakdownAction: vi.fn(),
  getExpenseByCategoryAction: vi.fn(),
}));
vi.mock("@/features/fleet-reports/actions/margin-actions", () => ({
  getFleetMarginAction: vi.fn(),
}));
vi.mock("@/features/clients/actions/sales-report-actions", () => ({
  getClientSalesSummaryAction: vi.fn(),
}));
vi.mock("@/features/hr/actions/hr-reports-actions", () => ({
  getPayrollSummaryAction: vi.fn(),
  getPayrollConceptsAction: vi.fn(),
  getDriverExtrasAction: vi.fn(),
  getVacationOverviewAction: vi.fn(),
  getLeavesSummaryAction: vi.fn(),
  getAttendanceSummaryAction: vi.fn(),
}));

import { getAccountTypeTotalsAction } from "@/features/balance/actions/statements-actions";
import type { AccountTypeTotalsRow } from "@/features/balance/reports-schema";
import { getClientSalesSummaryAction } from "@/features/clients/actions/sales-report-actions";
import type { ClientSalesSummaryRow } from "@/features/clients/reports-schema";
import { getFleetMarginAction } from "@/features/fleet-reports/actions/margin-actions";
import type { FleetMarginRow } from "@/features/fleet-reports/schema";
import { getPayrollSummaryAction } from "@/features/hr/actions/hr-reports-actions";
import type { PayrollSummaryRow } from "@/features/hr/reports-schema";

import { getFleetMargin } from "./fleet";
import { getPayrollSummary } from "./payroll";
import { getClientSalesSummary } from "./sales";
import {
  balanceSheetTotals,
  getBalanceSheet,
  getIncomeStatement,
  incomeStatementLines,
} from "./statements";
import { resolveAccess } from "@/lib/auth/permissions";

const owner = { userId: "u1", access: resolveAccess(["owner" as const]) };

function totals(
  account_type: string,
  eerr_category: string,
  balance: number,
): AccountTypeTotalsRow {
  return {
    account_type,
    eerr_category,
    accounts: 1,
    total_debit: Math.max(balance, 0),
    total_credit: Math.max(-balance, 0),
    balance,
  };
}

const PERIOD_A = [
  totals("resultado_positivo", "Ventas", -1000),
  totals("resultado_negativo", "Combustible", 300),
  totals("resultado_negativo", "", 100),
  totals("activo", "", 5000),
];
const PERIOD_B = [
  totals("resultado_positivo", "Ventas", -800),
  totals("resultado_negativo", "Combustible", 200),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("incomeStatementLines / balanceSheetTotals", () => {
  it("turns signed journal balances into positive income and expense lines", () => {
    const r = incomeStatementLines(PERIOD_A);
    expect(r.totalIncome).toBe(1000);
    expect(r.totalExpenses).toBe(400);
    expect(r.net).toBe(600);
    expect(r.expenses.map((l) => l.category)).toContain("Sin categoría");
  });

  it("checks assets against liabilities, equity and accumulated results", () => {
    const r = balanceSheetTotals([
      totals("activo", "", 1500),
      totals("pasivo", "", -700),
      totals("patrimonio", "", -500),
      totals("resultado_positivo", "", -1000),
      totals("resultado_negativo", "", 700),
    ]);
    expect(r).toEqual({
      activo: 1500,
      pasivo: 700,
      patrimonio: 500,
      resultados: 300,
      difference: 0,
    });
  });
});

describe("getIncomeStatement", () => {
  it("compares two ranges with server totals and cites its sources", async () => {
    vi.mocked(getAccountTypeTotalsAction)
      .mockResolvedValueOnce({ ok: true, data: PERIOD_A })
      .mockResolvedValueOnce({ ok: true, data: PERIOD_B });
    const res = await getIncomeStatement.execute(owner, {
      periodStart: "2026-04",
      periodEnd: "2026-06",
      compareStart: "2026-01",
      compareEnd: "2026-03",
    });
    expect(getAccountTypeTotalsAction).toHaveBeenNthCalledWith(1, {
      periodStart: "2026-04",
      periodEnd: "2026-06",
      costCenterId: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({
      comparison: { net: { current: 600, previous: 600, delta: 0 } },
    });
    expect(res.meta.sources).toContain("ai_account_type_totals");
    expect(res.meta.currency).toBe("ARS");
  });

  it("requires both ends of the comparison range", async () => {
    const res = await getIncomeStatement.execute(owner, {
      periodStart: "2026-04",
      periodEnd: "2026-06",
      compareStart: "2026-01",
    });
    expect(res.ok).toBe(false);
    expect(getAccountTypeTotalsAction).not.toHaveBeenCalled();
  });
});

describe("getBalanceSheet", () => {
  it("flags an unbalanced sheet in the summary", async () => {
    vi.mocked(getAccountTypeTotalsAction).mockResolvedValue({
      ok: true,
      data: [totals("activo", "", 100)],
    });
    const res = await getBalanceSheet.execute(owner, { periodEnd: "2026-06" });
    expect(res.summary).toContain("DESCUADRE");
  });
});

function marginRow(over: Partial<FleetMarginRow>): FleetMarginRow {
  return {
    group_key: "v1",
    label: "AB123CD",
    trips: 2,
    revenue: 1000,
    invoiced_revenue: 1000,
    manual_revenue: 0,
    trip_cost: 200,
    fuel_cost: 100,
    maintenance_cost: 50,
    net: 650,
    margin_pct: 65,
    total_groups: 1,
    total_revenue: 1000,
    total_net: 650,
    ...over,
  };
}

describe("getFleetMargin", () => {
  it("reports the window totals and flags a truncated page as partial", async () => {
    vi.mocked(getFleetMarginAction).mockResolvedValue({
      ok: true,
      data: [
        marginRow({ total_groups: 80, total_revenue: 9000, total_net: 4000 }),
      ],
    });
    const res = await getFleetMargin.execute(owner, {
      from: "2026-01-01",
      to: "2026-03-31",
      groupBy: "driver",
      limit: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toContain("80 grupos");
    expect(res.meta.partial).toBe(true);
  });
});

describe("getClientSalesSummary", () => {
  it("needs clients, invoices and receipts reads", () => {
    expect(getClientSalesSummary.permissions).toEqual([
      "clients:read",
      "invoices:read",
      "receipts:read",
    ]);
  });

  it("is not partial when every client fits the page", async () => {
    const row: ClientSalesSummaryRow = {
      client_id: "c1",
      legal_name: "Acme",
      invoiced_ars: 100,
      invoices: 1,
      credit_notes: 0,
      collected_ars: 50,
      collected_usd: 0,
      receipts: 1,
      avg_days_to_pay: 12,
      open_ars: 50,
      open_foreign: 0,
      overdue_ars: 0,
      total_clients: 1,
      total_invoiced_ars: 100,
      total_collected_ars: 50,
      total_open_ars: 50,
    };
    vi.mocked(getClientSalesSummaryAction).mockResolvedValue({
      ok: true,
      data: [row],
    });
    const res = await getClientSalesSummary.execute(owner, {
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(res.ok && res.meta.partial).toBe(false);
    expect(res.ok && res.summary).toMatch(/^Todos los canales: /);
  });

  it("forwards the scope and labels the figures with it", async () => {
    vi.mocked(getClientSalesSummaryAction).mockResolvedValue({
      ok: true,
      data: [],
    });
    const input = { from: "2026-05-01", to: "2026-05-31", scope: "fiscal" };
    const res = await getClientSalesSummary.execute(owner, input);
    expect(getClientSalesSummaryAction).toHaveBeenCalledWith(input);
    expect(res.ok && res.summary).toMatch(/^Solo fiscal: /);
  });
});

describe("getPayrollSummary", () => {
  it("adds the per-group SQL totals and states that amounts are net", async () => {
    const row = (
      period: string,
      total: number,
      paid: number,
    ): PayrollSummaryRow => ({
      group_key: period,
      label: period,
      periods: 1,
      employees: 3,
      sueldo_neto: total,
      extras: 0,
      vacaciones: 0,
      viaticos: 0,
      deudas: 0,
      telefono: 0,
      total_a_pagar: total,
      paid,
      saldo: total - paid,
    });
    vi.mocked(getPayrollSummaryAction).mockResolvedValue({
      ok: true,
      data: [row("2026-01", 1000, 1000), row("2026-02", 1200, 900)],
    });
    const res = await getPayrollSummary.execute(
      { userId: "u1", access: resolveAccess(["finance"]) },
      { fromPeriod: "2026-01", toPeriod: "2026-02" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({
      totals: { total_a_pagar: 2200, paid: 1900, saldo: 300 },
    });
    expect(res.meta.note).toContain("netos");
  });

  it("takes the balance from SQL when a scope narrows what was paid", async () => {
    const scoped: PayrollSummaryRow = {
      group_key: "2026-02",
      label: "2026-02",
      periods: 1,
      employees: 3,
      sueldo_neto: 1200,
      extras: 0,
      vacaciones: 0,
      viaticos: 0,
      deudas: 0,
      telefono: 0,
      total_a_pagar: 1200,
      paid: 400,
      saldo: 300,
    };
    vi.mocked(getPayrollSummaryAction).mockResolvedValue({
      ok: true,
      data: [scoped],
    });
    const res = await getPayrollSummary.execute(
      { userId: "u1", access: resolveAccess(["finance"]) },
      { fromPeriod: "2026-02", toPeriod: "2026-02", scope: "fiscal" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({
      totals: { total_a_pagar: 1200, paid: 400, saldo: 300 },
    });
    expect(res.summary).toContain("pagado (Solo fiscal)");
  });
});
