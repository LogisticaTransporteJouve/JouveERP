import { z } from "zod";

import {
  getReconciliationAction,
  listReconciliationAccountsAction,
} from "@/features/bank-reconciliation/actions/reconciliation-actions";
import type { ReconciliationAccount } from "@/features/bank-reconciliation/schema";
import { getCashFlowAction } from "@/features/treasury/actions/cash-flow-actions";
import { getTreasurySummaryAction } from "@/features/treasury/actions/treasury-actions";
import { TREASURY_PERMISSIONS } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/format";
import { IsoDateSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, money, okResult } from "../result";

export async function runTreasurySummary(): Promise<AiRunResult> {
  const res = await getTreasurySummaryAction();
  if (!res.ok) return errResult(res.error);
  const d = res.data;
  return okResult(
    `Caja real (todos los canales): ${d.accounts.length} active accounts · ` +
      `${d.checks_due_soon.count} ARS checks in portfolio due soon (7 days; ` +
      `pesos only, USD portfolio in checks_usd_now).`,
    d,
    {
      note: "Tesorería es la caja real de todos los canales: no se separa por canal.",
    },
  );
}

export const getTreasurySummary = defineAiAction({
  name: "getTreasurySummary",
  domain: "tesoreria",
  permission: TREASURY_PERMISSIONS,
  sideEffect: "read",
  sources: ["accounts", "account_movement_totals", "checks"],
  description:
    "Treasury summary: balances per account and currency (ARS/USD), current " +
    "totals vs. end of previous month, and the ARS (pesos only) portfolio " +
    "checks due within 7 days. " +
    "No parameters. Useful for 'how's the cash doing?'.",
  input: z.object({}),
  run: () => runTreasurySummary(),
});

const CASH_FLOW_NOTE =
  "Flujo de caja en pesos de todos los canales (facturado, interno y otro por separado en cada mes). Los meses pasados y el actual son movimientos reales de caja; los futuros proyectan pagos recurrentes, cobranzas y pagos pendientes por vencimiento (lo vencido cae en el primer mes proyectado), cheques en cartera y cuotas de préstamos, con el saldo de cierre proyectado desde la caja de hoy. Lo que está en dólares se pasa a pesos a la última cotización oficial.";

export const getCashFlow = defineAiAction({
  name: "getCashFlow",
  domain: "tesoreria",
  permission: TREASURY_PERMISSIONS,
  sideEffect: "read",
  sources: [
    "accounts",
    "account_movement_totals",
    "transaction_monthly_flows",
    "recurring_payments",
    "v_aging_documents",
    "v_purchase_invoice_open",
    "checks",
    "loan_installments",
    "exchange_rates",
  ],
  description:
    "Flujo de caja mensual (la página Flujo de caja): meses pasados reales y meses futuros proyectados con ingresos, egresos, neto y saldo de cierre proyectado, la caja de hoy, el saldo mínimo proyectado y el primer mes con déficit. Para '¿cómo viene la caja los próximos meses?' o '¿cuándo nos quedamos sin plata?'.",
  input: z.object({
    monthsBack: z
      .number()
      .int()
      .min(0)
      .max(24)
      .nullish()
      .describe("Meses reales hacia atrás (default 3, máx 24)."),
    monthsFwd: z
      .number()
      .int()
      .min(1)
      .max(24)
      .nullish()
      .describe("Meses proyectados hacia adelante (default 6, máx 24)."),
  }),
  run: async (_ctx, input) => {
    const res = await getCashFlowAction({
      monthsBack: input.monthsBack ?? undefined,
      monthsFwd: input.monthsFwd ?? undefined,
    });
    if (!res.ok) return errResult(res.error);
    const d = res.data;
    return okResult(
      `Flujo de caja (todos los canales): caja hoy ${money(d.cashToday)} · ` +
        `saldo mínimo proyectado ${d.lowestClosing === null ? "—" : money(d.lowestClosing)}` +
        (d.deficitMonth
          ? ` · primer mes con déficit ${d.deficitMonth}.`
          : " · sin déficit proyectado.") +
        (d.usdSkipped
          ? " Sin cotización USD cargada: lo que está en dólares quedó afuera (cifras parciales)."
          : ""),
      d,
      {
        currency: "ARS",
        partial: d.usdSkipped,
        note: CASH_FLOW_NOTE,
        modelNote: "usdRate is the official rate the USD amounts use.",
      },
    );
  },
});

function normName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

/** A reconciliation account by the name the user said: the exact name, else
 *  the one name that contains it; otherwise the candidates to ask about. */
export async function findReconciliationAccount(
  said: string,
): Promise<
  | { ok: true; account: ReconciliationAccount }
  | { ok: false; error: string; options: ReconciliationAccount[] }
> {
  const accounts = await listReconciliationAccountsAction();
  if (!accounts.ok) return { ok: false, error: accounts.error, options: [] };
  const q = normName(said);
  const exact = accounts.data.filter((a) => normName(a.name) === q);
  const close = accounts.data.filter((a) => normName(a.name).includes(q));
  const account =
    exact.length === 1 ? exact[0] : close.length === 1 ? close[0] : undefined;
  if (account) return { ok: true, account };
  return {
    ok: false,
    error:
      close.length === 0
        ? `No hay una cuenta que se concilie con el nombre "${said}".`
        : `"${said}" coincide con varias cuentas.`,
    options: close.length ? close : accounts.data,
  };
}

const OPEN_LINES_MAX = 200;

export const getBankReconciliation = defineAiAction({
  name: "getBankReconciliation",
  domain: "tesoreria",
  permission: "transactions:read",
  sideEffect: "read",
  sources: ["bank_statement_lines", "bank_statement_matches", "transactions"],
  description:
    "Conciliación bancaria de UNA cuenta en un período (hasta un año): saldo del extracto contra el de libros y su diferencia, cuántas líneas del extracto están conciliadas, pendientes o ignoradas, los movimientos de libros que ninguna línea explica, las líneas pendientes (fecha, descripción, importe) y cuáles tienen una conciliación sugerida. Para '¿qué falta conciliar del Galicia en octubre?'. Para proponer las conciliaciones usá proposeBankMatches.",
  input: z
    .object({
      account: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe("Nombre de la cuenta de tesorería, como lo dijo el usuario."),
      from: IsoDateSchema.describe("Fecha desde, YYYY-MM-DD."),
      to: IsoDateSchema.describe("Fecha hasta, YYYY-MM-DD (inclusive)."),
    })
    .refine(
      (v) => v.from <= v.to,
      "La fecha desde es posterior a la fecha hasta.",
    ),
  run: async (_ctx, input) => {
    const found = await findReconciliationAccount(input.account);
    if (!found.ok) {
      const options = found.options.slice(0, 10).map((a) => a.name);
      return errResult(
        options.length
          ? `${found.error} Cuentas: ${options.join(", ")}.`
          : found.error,
      );
    }
    const { account } = found;
    const res = await getReconciliationAction({
      account_id: account.id,
      from: input.from,
      to: input.to,
    });
    if (!res.ok) return errResult(res.error);
    const { summary, suggestions } = res.data;
    const open = res.data.lines.filter((l) => l.status === "open");
    const suggested = new Set(suggestions.map((s) => s.line_id));
    const openLines = open.slice(0, OPEN_LINES_MAX).map((l) => ({
      id: l.id,
      line_date: l.line_date,
      description: l.description,
      amount: l.amount,
      reference: l.reference,
      has_suggestion: suggested.has(l.id),
    }));
    const cur = account.currency;
    const cut = open.length > OPEN_LINES_MAX;
    return okResult(
      `${account.name} ${input.from}→${input.to}: ${summary.open_count} líneas pendientes ` +
        `(${formatMoney(summary.open_total, cur)}), ${summary.matched_count} conciliadas, ` +
        `${summary.ignored_count} ignoradas · ${summary.unmatched_book_count} movimientos de ` +
        `libros sin línea (${formatMoney(summary.unmatched_book_total, cur)}) · ` +
        (summary.difference === null
          ? "el extracto no trae saldo."
          : `diferencia extracto − libros ${formatMoney(summary.difference, cur)}.`) +
        ` ${suggested.size} línea(s) con conciliación sugerida.`,
      { account, summary, openLines },
      {
        currency: cur,
        partial: cut,
        ...(cut
          ? {
              note: `Se listan ${OPEN_LINES_MAX} de ${open.length} líneas pendientes.`,
            }
          : {}),
      },
    );
  },
});
