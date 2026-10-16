import type { ReactNode } from "react";

import { getAgingSummaryAction } from "@/features/aging/actions/aging-actions";
import { DashboardInsights } from "@/features/ai/insights/components/dashboard-insights";
import {
  getDashboardDueDatesAction,
  getDashboardOpsAction,
  getMyDashboardLayoutAction,
} from "@/features/dashboard/actions/dashboard-actions";
import { CashFlowChart } from "@/features/dashboard/components/cash-flow-chart";
import { DashboardCanvas } from "@/features/dashboard/components/dashboard-canvas";
import { DueDatesCard } from "@/features/dashboard/components/due-dates-card";
import { FinanceKpis } from "@/features/dashboard/components/finance-kpis";
import { OpsKpisRow } from "@/features/dashboard/components/ops-kpis";
import { QuickActions } from "@/features/dashboard/components/quick-actions";
import { TopDebtorsCard } from "@/features/dashboard/components/top-debtors-card";
import {
  defaultLayoutForRoles,
  type DashboardAgingKpis,
  type TopDebtor,
  type WidgetId,
} from "@/features/dashboard/schema";
import { getSupplierAgingAction } from "@/features/suppliers/actions/account-actions";
import { getCashFlowAction } from "@/features/treasury/actions/cash-flow-actions";
import { getTreasurySummaryAction } from "@/features/treasury/actions/treasury-actions";
import type { AgingReport } from "@/lib/aging";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

const TOP_DEBTORS = 5;

export default async function DashboardPage() {
  const ctx = await requireUserContext();

  const canAccounting = userCan(ctx.roles, "accounting:read");
  const [
    treasuryRes,
    agingRes,
    supplierAgingRes,
    dueDatesRes,
    cashFlowRes,
    opsRes,
    layoutRes,
  ] = await Promise.all([
    canAccounting ? getTreasurySummaryAction() : null,
    userCan(ctx.roles, "clients:read") ? getAgingSummaryAction() : null,
    userCan(ctx.roles, "suppliers:read") ? getSupplierAgingAction() : null,
    getDashboardDueDatesAction(),
    canAccounting ? getCashFlowAction({ monthsBack: 3, monthsFwd: 6 }) : null,
    getDashboardOpsAction(),
    getMyDashboardLayoutAction(),
  ]);

  const treasury = treasuryRes?.ok ? treasuryRes.data : null;
  const aging = agingRes?.ok ? agingRes.data : null;
  const supplierAging = supplierAgingRes?.ok ? supplierAgingRes.data : null;
  const cashFlow = cashFlowRes?.ok ? cashFlowRes.data : null;
  const ops = opsRes.ok ? opsRes.data : null;
  const savedLayout = layoutRes.ok ? layoutRes.data : null;

  const toKpis = (report: AgingReport): DashboardAgingKpis => ({
    total: report.totals.total,
    total_ars_equivalent: report.totals.total_ars_equivalent,
    bucket_90_plus: report.totals.buckets["90_plus"],
    party_count: report.totals.party_count,
  });
  const receivables = aging ? toKpis(aging) : null;
  const payables = supplierAging ? toKpis(supplierAging) : null;

  // getAgingSummaryAction already sorts by ARS-equivalent exposure.
  const topDebtors: TopDebtor[] = (aging?.rows ?? [])
    .slice(0, TOP_DEBTORS)
    .map((c) => ({
      client_id: c.id,
      name: c.display_name ?? c.legal_name,
      cuit: c.cuit,
      total: c.total,
      total_ars_equivalent: c.total_ars_equivalent,
      oldest_days: c.oldest_days,
    }));

  // Widget catalog: only widgets whose data the caller can see get an entry;
  // the canvas hides layout items with no entry.
  const widgets: Partial<Record<WidgetId, ReactNode>> = {};
  if (treasury || receivables || payables) {
    widgets.finance_kpis = (
      <FinanceKpis
        treasury={
          treasury
            ? {
                as_of: treasury.as_of,
                liquid_now: treasury.liquid_now,
                liquid_prev_eom: treasury.liquid_prev_eom,
                usd_rate: treasury.usd_rate,
                checks_now: treasury.checks_now,
                checks_due_soon: treasury.checks_due_soon,
              }
            : null
        }
        receivables={receivables}
        payables={payables}
      />
    );
  }
  if (
    ops &&
    (ops.trips_in_progress != null ||
      ops.shipments_pending != null ||
      ops.pallets_stored != null)
  ) {
    widgets.ops_kpis = <OpsKpisRow ops={ops} />;
  }
  if (cashFlow) {
    widgets.cash_flow = (
      <CashFlowChart
        data={{
          months: cashFlow.months,
          cashToday: cashFlow.cashToday,
          lowestClosing: cashFlow.lowestClosing,
          deficitMonth: cashFlow.deficitMonth,
          usdRate: cashFlow.usdRate,
        }}
      />
    );
  }
  if (userCan(ctx.roles, "ai:read")) {
    widgets.insights = (
      <DashboardInsights canManage={userCan(ctx.roles, "ai:admin")} />
    );
  }
  if (dueDatesRes.ok) {
    widgets.due_dates = <DueDatesCard items={dueDatesRes.data} />;
  }
  if (aging) {
    widgets.top_debtors = <TopDebtorsCard debtors={topDebtors} />;
  }

  const template = defaultLayoutForRoles(ctx.roles).filter(
    (item) => widgets[item.id] != null,
  );
  const resolvedLayout = (savedLayout ?? template).filter(
    (item) => widgets[item.id] != null,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Resumen de caja, cobranzas, pagos y vencimientos de DZ &amp; Sons.
          </p>
        </div>
        <QuickActions roles={ctx.roles} />
      </div>

      {Object.keys(widgets).length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Usá el menú lateral para acceder a tus módulos habilitados.
        </div>
      ) : (
        <DashboardCanvas
          initialLayout={resolvedLayout}
          defaultLayout={template}
          widgets={widgets}
        />
      )}
    </div>
  );
}
