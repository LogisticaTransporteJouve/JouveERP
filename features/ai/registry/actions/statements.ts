import { z } from "zod";

import {
  getAccountTypeTotalsAction,
  getCostCenterBreakdownAction,
  getExpenseByCategoryAction,
} from "@/features/balance/actions/statements-actions";
import {
  PeriodRangeReportInputSchema,
  type AccountTypeTotalsRow,
} from "@/features/balance/reports-schema";
import {
  getUsdRateForDateAction,
  listExchangeRatesAction,
} from "@/features/exchange-rates/actions/exchange-rates-actions";
import {
  getLoanAction,
  listLoansAction,
} from "@/features/loans/actions/loans-actions";
import {
  IsoDateSchema,
  PeriodSchema,
  UuidSchema,
} from "@/lib/validation/common";

import { defineAiAction } from "../define";
import {
  errResult,
  money,
  okResult,
  reachedCap,
  type AiRunResult,
} from "../result";

// Financial statements built from ai_account_type_totals (one SQL aggregate
// per period, grouped by account type and EERR category), plus loans and
// exchange rates. The JS here only combines those per-category aggregates.

const FISCAL_NOTE =
  "Libros contables: reflejan solo los canales fiscales (asientos automáticos).";

type Line = { category: string; amount: number };

const RESULT_TYPES = new Set(["resultado_positivo", "resultado_negativo"]);

function categoryLabel(row: AccountTypeTotalsRow): string {
  return row.eerr_category || "Sin categoría";
}

/** Income and expenses as positive amounts per EERR category. */
export function incomeStatementLines(rows: readonly AccountTypeTotalsRow[]): {
  income: Line[];
  expenses: Line[];
  totalIncome: number;
  totalExpenses: number;
  net: number;
} {
  const income = rows
    .filter((r) => r.account_type === "resultado_positivo")
    .map((r) => ({ category: categoryLabel(r), amount: -r.balance }));
  const expenses = rows
    .filter((r) => r.account_type === "resultado_negativo")
    .map((r) => ({ category: categoryLabel(r), amount: r.balance }));
  const totalIncome = income.reduce((s, l) => s + l.amount, 0);
  const totalExpenses = expenses.reduce((s, l) => s + l.amount, 0);
  return {
    income,
    expenses,
    totalIncome,
    totalExpenses,
    net: totalIncome - totalExpenses,
  };
}

/** Assets, liabilities, equity and accumulated results at a cutoff. */
export function balanceSheetTotals(rows: readonly AccountTypeTotalsRow[]): {
  activo: number;
  pasivo: number;
  patrimonio: number;
  resultados: number;
  difference: number;
} {
  const byType = (t: string) =>
    rows.filter((r) => r.account_type === t).reduce((s, r) => s + r.balance, 0);
  const activo = byType("activo");
  const pasivo = -byType("pasivo");
  const patrimonio = -byType("patrimonio");
  const resultados = -rows
    .filter((r) => RESULT_TYPES.has(r.account_type))
    .reduce((s, r) => s + r.balance, 0);
  return {
    activo,
    pasivo,
    patrimonio,
    resultados,
    difference: activo - pasivo - patrimonio - resultados,
  };
}

function delta(current: number, previous: number) {
  return {
    current,
    previous,
    delta: current - previous,
    deltaPct:
      previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : null,
  };
}

const IncomeStatementInputSchema = z
  .object({
    periodStart: PeriodSchema.describe("Período desde, YYYY-MM."),
    periodEnd: PeriodSchema.describe("Período hasta, YYYY-MM (inclusive)."),
    compareStart: PeriodSchema.nullish().describe(
      "Período desde a comparar, YYYY-MM (opcional).",
    ),
    compareEnd: PeriodSchema.nullish().describe(
      "Período hasta a comparar, YYYY-MM (opcional).",
    ),
    costCenterId: UuidSchema.nullish().describe(
      "UUID de un centro de costo (opcional).",
    ),
  })
  .refine((v) => v.periodStart <= v.periodEnd, "Rango de períodos invertido.")
  .refine(
    (v) => !v.compareStart === !v.compareEnd,
    "Para comparar indicá compareStart y compareEnd.",
  );

export const getIncomeStatement = defineAiAction({
  name: "getIncomeStatement",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: [
    "ai_account_type_totals",
    "journal_entry_lines",
    "chart_of_accounts",
  ],
  description:
    "Estado de resultados (EERR) de un rango de períodos por categoría: ingresos, gastos y resultado neto; opcionalmente comparado con otro rango (variación absoluta y %) y filtrado por centro de costo.",
  input: IncomeStatementInputSchema,
  run: async (_ctx, input): Promise<AiRunResult> => {
    const costCenterId = input.costCenterId ?? null;
    const [cur, prev] = await Promise.all([
      getAccountTypeTotalsAction({
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        costCenterId,
      }),
      input.compareStart && input.compareEnd
        ? getAccountTypeTotalsAction({
            periodStart: input.compareStart,
            periodEnd: input.compareEnd,
            costCenterId,
          })
        : Promise.resolve(null),
    ]);
    if (!cur.ok) return errResult(cur.error);
    if (prev && !prev.ok) return errResult(prev.error);
    const current = incomeStatementLines(cur.data);
    const previous = prev ? incomeStatementLines(prev.data) : null;
    const comparison = previous
      ? {
          range: `${input.compareStart}→${input.compareEnd}`,
          income: delta(current.totalIncome, previous.totalIncome),
          expenses: delta(current.totalExpenses, previous.totalExpenses),
          net: delta(current.net, previous.net),
        }
      : null;
    return okResult(
      `EERR ${input.periodStart}→${input.periodEnd}: ingresos ${money(
        current.totalIncome,
      )} · gastos ${money(current.totalExpenses)} · resultado ${money(current.net)}` +
        (comparison
          ? ` (vs ${comparison.range}: ${money(comparison.net.previous)}, Δ ${money(
              comparison.net.delta,
            )}).`
          : "."),
      { current, previous, comparison },
      { currency: "ARS", note: FISCAL_NOTE },
    );
  },
});

const BalanceSheetInputSchema = z.object({
  periodEnd: PeriodSchema.describe("Período de corte, YYYY-MM."),
  comparePeriodEnd: PeriodSchema.nullish().describe(
    "Otro período de corte a comparar, YYYY-MM (opcional).",
  ),
});

export const getBalanceSheet = defineAiAction({
  name: "getBalanceSheet",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: [
    "ai_account_type_totals",
    "journal_entry_lines",
    "chart_of_accounts",
  ],
  description:
    "Balance general acumulado a un período: activo, pasivo, patrimonio neto y resultados acumulados, con detalle por categoría y control de cuadre; opcionalmente comparado con otro corte.",
  input: BalanceSheetInputSchema,
  run: async (_ctx, input): Promise<AiRunResult> => {
    const [cur, prev] = await Promise.all([
      getAccountTypeTotalsAction({ periodEnd: input.periodEnd }),
      input.comparePeriodEnd
        ? getAccountTypeTotalsAction({ periodEnd: input.comparePeriodEnd })
        : Promise.resolve(null),
    ]);
    if (!cur.ok) return errResult(cur.error);
    if (prev && !prev.ok) return errResult(prev.error);
    const current = balanceSheetTotals(cur.data);
    const previous = prev ? balanceSheetTotals(prev.data) : null;
    return okResult(
      `Balance al ${input.periodEnd}: activo ${money(current.activo)} · pasivo ${money(
        current.pasivo,
      )} · PN ${money(current.patrimonio)} · resultados ${money(current.resultados)}` +
        (Math.abs(current.difference) >= 0.01
          ? ` · DESCUADRE ${money(current.difference)}.`
          : "."),
      {
        current,
        previous,
        comparison: previous
          ? {
              activo: delta(current.activo, previous.activo),
              pasivo: delta(current.pasivo, previous.pasivo),
              patrimonio: delta(current.patrimonio, previous.patrimonio),
            }
          : null,
        rows: cur.data,
      },
      { currency: "ARS", note: FISCAL_NOTE },
    );
  },
});

export const getCostCenterBreakdown = defineAiAction({
  name: "getCostCenterBreakdown",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["ai_cost_center_breakdown", "journal_entries", "cost_centers"],
  description:
    "Resultados por centro de costo en un rango de períodos: ingresos y gastos por centro (incluye 'sin centro de costo').",
  input: PeriodRangeReportInputSchema,
  run: async (_ctx, input) => {
    const res = await getCostCenterBreakdownAction(input);
    if (!res.ok) return errResult(res.error);
    const centers = new Set(res.data.map((r) => r.cost_center_name)).size;
    return okResult(
      `${centers} centros de costo con movimiento entre ${input.periodStart} y ${input.periodEnd}.`,
      { rows: res.data },
      { currency: "ARS", note: FISCAL_NOTE },
    );
  },
});

export const getExpenseByCategory = defineAiAction({
  name: "getExpenseByCategory",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: [
    "ai_expense_by_category",
    "journal_entry_lines",
    "chart_of_accounts",
  ],
  description:
    "Gastos por categoría y mes en un rango de períodos (cuentas de resultado negativo), para ver la evolución del gasto.",
  input: PeriodRangeReportInputSchema,
  run: async (_ctx, input) => {
    const res = await getExpenseByCategoryAction(input);
    if (!res.ok) return errResult(res.error);
    const total = res.data.reduce((s, r) => s + r.amount, 0);
    return okResult(
      `Gastos ${input.periodStart}→${input.periodEnd}: ${money(total)} en ${
        new Set(res.data.map((r) => r.category)).size
      } categorías.`,
      { rows: res.data },
      {
        currency: "ARS",
        partial: reachedCap(res.data.length),
        note: FISCAL_NOTE,
      },
    );
  },
});

export const getLoans = defineAiAction({
  name: "getLoans",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["loans", "loan_installments"],
  description:
    "Préstamos y leasings: acreedor, capital, moneda, estado, pagado, pendiente, cuotas pendientes y próximo vencimiento. Sin parámetros.",
  input: z.object({}),
  run: async () => {
    const res = await listLoansAction();
    if (!res.ok) return errResult(res.error);
    const active = res.data.filter((l) => l.status === "active");
    const pendingByCurrency: Record<string, number> = {};
    for (const l of active) {
      pendingByCurrency[l.currency] =
        (pendingByCurrency[l.currency] ?? 0) + l.pending_total;
    }
    return okResult(
      `${res.data.length} préstamos (${active.length} activos) · pendiente ${
        Object.entries(pendingByCurrency)
          .map(([c, v]) => `${c} ${money(v)}`)
          .join(" · ") || "$0"
      }.`,
      { loans: res.data, pendingByCurrency },
    );
  },
});

export const getLoanDetail = defineAiAction({
  name: "getLoanDetail",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["loans", "loan_installments"],
  description:
    "Detalle de UN préstamo con su cronograma de cuotas (vencimiento, monto, estado, pago). Requiere el UUID del préstamo (de getLoans).",
  input: z.object({ loanId: UuidSchema.describe("UUID del préstamo.") }),
  run: async (_ctx, input) => {
    const res = await getLoanAction(input.loanId);
    if (!res.ok) return errResult(res.error);
    return okResult(
      `${res.data.description}: ${res.data.installments.length} cuotas · pendiente ${res.data.currency} ${money(
        res.data.pending_total,
      )}.`,
      res.data,
      { currency: res.data.currency },
    );
  },
});

export const getExchangeRates = defineAiAction({
  name: "getExchangeRates",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: ["exchange_rates"],
  description:
    "Cotizaciones cargadas (moneda, fecha, valor, fuente; últimas 500). Con 'date' devuelve la cotización USD vigente a esa fecha.",
  input: z.object({
    date: IsoDateSchema.nullish().describe(
      "Fecha YYYY-MM-DD para obtener la cotización USD vigente (opcional).",
    ),
  }),
  run: async (_ctx, input) => {
    if (input.date) {
      const date = input.date;
      const res = await getUsdRateForDateAction(date);
      if (!res.ok) return errResult(res.error);
      const rate = res.data.rate;
      return okResult(
        rate === null
          ? `Sin cotización USD cargada a ${date}.`
          : `USD a ${date}: ${rate.toLocaleString("es-AR")}.`,
        res.data,
        rate === null ? {} : { exchangeRate: { currency: "USD", rate, date } },
      );
    }
    const res = await listExchangeRatesAction();
    if (!res.ok) return errResult(res.error);
    const latest = res.data[0];
    return okResult(
      `${res.data.length} cotizaciones${
        latest
          ? ` · última ${latest.currency} ${latest.rate.toLocaleString("es-AR")} (${latest.rate_date})`
          : ""
      }.`,
      res.data,
      { partial: reachedCap(res.data.length, 500) },
    );
  },
});
