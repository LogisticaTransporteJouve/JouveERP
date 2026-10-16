"use server";

import { gatedRead } from "@/lib/actions/gated-read";
import type { ActionResult } from "@/lib/query/run-action";

import {
  AccountTypeTotalsInputSchema,
  PeriodRangeReportInputSchema,
  type AccountTypeTotalsRow,
  type CostCenterBreakdownRow,
  type ExpenseByCategoryRow,
} from "../reports-schema";

// Journal aggregates over security-invoker RPCs (accounting RLS applies),
// gated on accounting:read like the balance and ledger reads.

const ACCOUNTING_READ = {
  permissions: ["accounting:read"],
  denied: "No tenés permiso para ver la contabilidad.",
  failure: "No se pudo calcular el reporte contable.",
} as const;

export async function getAccountTypeTotalsAction(
  input: unknown,
): Promise<ActionResult<AccountTypeTotalsRow[]>> {
  return gatedRead({
    ...ACCOUNTING_READ,
    schema: AccountTypeTotalsInputSchema,
    input,
    event: "accounting.account_type_totals.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_account_type_totals", {
        p_period_end: v.periodEnd,
        p_period_start: v.periodStart ?? undefined,
        p_cost_center_id: v.costCenterId ?? undefined,
      }),
  });
}

export async function getCostCenterBreakdownAction(
  input: unknown,
): Promise<ActionResult<CostCenterBreakdownRow[]>> {
  return gatedRead({
    ...ACCOUNTING_READ,
    schema: PeriodRangeReportInputSchema,
    input,
    event: "accounting.cost_center_breakdown.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_cost_center_breakdown", {
        p_period_start: v.periodStart,
        p_period_end: v.periodEnd,
      }),
  });
}

export async function getExpenseByCategoryAction(
  input: unknown,
): Promise<ActionResult<ExpenseByCategoryRow[]>> {
  return gatedRead({
    ...ACCOUNTING_READ,
    schema: PeriodRangeReportInputSchema,
    input,
    event: "accounting.expense_by_category.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_expense_by_category", {
        p_period_start: v.periodStart,
        p_period_end: v.periodEnd,
      }),
  });
}
