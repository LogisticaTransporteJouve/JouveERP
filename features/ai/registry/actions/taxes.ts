import { z } from "zod";

import {
  getIvaPositionEstimateAction,
  listTaxDocumentsAction,
} from "@/features/taxes/actions/tax-documents-actions";
import {
  isOpenTaxStatus,
  previousPeriod,
  taxDocumentLabel,
  type IvaPositionEstimate,
  type TaxDocument,
} from "@/features/taxes/schema";
import { addDaysIso } from "@/lib/date-range";
import { todayInAR } from "@/lib/format";
import { PeriodSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, money, okResult } from "../result";

// Read tool over /taxes: wraps listTaxDocumentsAction (taxes:read, so the
// accountant can ask too) and, when asked, getIvaPositionEstimateAction
// (its own taxes:write + accounting:read gate; a refusal leaves the
// estimate out and says why instead of failing the whole read).

export const DEFAULT_DUE_WITHIN_DAYS = 15;

/** What the model gets per document: the screen's own fields, labelled. */
export type TaxDocumentRow = {
  id: string;
  label: string;
  period: string;
  due_date: string;
  status: TaxDocument["status"];
  amount: number | null;
  amount_is_estimate: boolean;
  paid_date: string | null;
  paid_amount: number | null;
  credit_balance: number | null;
};

function toRow(d: TaxDocument): TaxDocumentRow {
  return {
    id: d.id,
    label: taxDocumentLabel(d),
    period: d.period,
    due_date: d.due_date,
    status: d.status,
    amount: d.amount,
    amount_is_estimate: d.amount_is_estimate,
    paid_date: d.paid_date,
    paid_amount: d.paid_amount,
    credit_balance: d.credit_balance,
  };
}

const sum = (
  rows: readonly TaxDocumentRow[],
  pick: (r: TaxDocumentRow) => number | null,
) => rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0);

/** Splits documents into overdue, due within `withinDays`, paid in
 *  `period` (by payment date) and the open ones whose amount is still an
 *  estimate. Annulled documents count nowhere. */
export function classifyTaxDocuments(
  docs: readonly TaxDocument[],
  opts: { today: string; withinDays: number; period: string },
) {
  const horizon = addDaysIso(opts.today, opts.withinDays);
  const rows = docs.map(toRow);
  const open = rows.filter((r) => isOpenTaxStatus(r.status));
  return {
    overdue: open.filter((r) => r.due_date < opts.today),
    due_soon: open.filter(
      (r) => r.due_date >= opts.today && r.due_date <= horizon,
    ),
    paid_in_period: rows.filter(
      (r) =>
        r.status === "pagado" &&
        r.paid_date !== null &&
        r.paid_date.slice(0, 7) === opts.period,
    ),
    open_estimates: open.filter((r) => r.amount_is_estimate),
  };
}

export async function runTaxDocuments(input: {
  period?: string | null;
  dueWithinDays?: number | null;
  ivaPeriod?: string | null;
}): Promise<AiRunResult> {
  const today = todayInAR();
  const period = input.period ?? today.slice(0, 7);
  const withinDays = input.dueWithinDays ?? DEFAULT_DUE_WITHIN_DAYS;

  // A year's list carries that year's documents plus every still-open
  // earlier one; a payment in `period` is usually of the month before.
  const years = [
    ...new Set(
      [today, period, previousPeriod(period)].map((p) => Number(p.slice(0, 4))),
    ),
  ];
  const byId = new Map<string, TaxDocument>();
  for (const year of years) {
    const res = await listTaxDocumentsAction({ year });
    if (!res.ok) return errResult(res.error);
    for (const d of res.data) byId.set(d.id, d);
  }
  const groups = classifyTaxDocuments([...byId.values()], {
    today,
    withinDays,
    period,
  });

  let ivaEstimate: IvaPositionEstimate | null = null;
  let note: string | undefined;
  if (input.ivaPeriod) {
    const est = await getIvaPositionEstimateAction({ period: input.ivaPeriod });
    if (est.ok) ivaEstimate = est.data;
    else note = `IVA estimate not available: ${est.error}`;
  }

  const parts = [
    `${groups.overdue.length} overdue (${money(sum(groups.overdue, (r) => r.amount))})`,
    `${groups.due_soon.length} due within ${withinDays} days (${money(sum(groups.due_soon, (r) => r.amount))})`,
    `${groups.paid_in_period.length} paid in ${period} (${money(sum(groups.paid_in_period, (r) => r.paid_amount))})`,
    `${groups.open_estimates.length} open with an estimated amount`,
  ];
  const unliquidated = [...groups.overdue, ...groups.due_soon].filter(
    (r) => r.amount === null,
  ).length;
  if (unliquidated > 0) {
    parts.push(`${unliquidated} due without amount yet (not in the sums)`);
  }
  if (ivaEstimate) {
    parts.push(
      `IVA ${ivaEstimate.period} estimate: ${
        ivaEstimate.saldo >= 0 ? "to pay" : "in favour"
      } ${money(Math.abs(ivaEstimate.saldo))}`,
    );
  }

  return okResult(
    `Taxes: ${parts.join("; ")}.`,
    {
      today,
      period,
      due_within_days: withinDays,
      ...groups,
      iva_estimate: ivaEstimate,
    },
    {
      currency: "ARS",
      ...(note ? { note } : {}),
      partial: note !== undefined,
    },
  );
}

export const getTaxDocuments = defineAiAction({
  name: "getTaxDocuments",
  domain: "contabilidad",
  permission: "taxes:read",
  sideEffect: "read",
  sources: [
    "tax_documents",
    "libro_iva_ventas",
    "libro_iva_compras",
    "receipt_retentions",
  ],
  description:
    "Tax obligations (Impuestos: IVA, IIBB, Ganancias anticipos, SICORE, " +
    "F931, monotributo, others): what is overdue, what is due soon, what " +
    "was paid in a month and which open amounts are still estimates, each " +
    "with period, due date, amount and status; optionally the IVA position " +
    "estimated from the libro IVA for one fiscal period. For tax due dates, " +
    "what we owe AFIP/ARBA or how much IVA we will pay.",
  input: z.object({
    period: PeriodSchema.nullish().describe(
      "Month (YYYY-MM) whose payments to list, by payment date. Default: the current month.",
    ),
    dueWithinDays: z
      .number()
      .int()
      .min(1)
      .max(90)
      .nullish()
      .describe(
        `How many days ahead count as due soon. Default ${DEFAULT_DUE_WITHIN_DAYS}.`,
      ),
    ivaPeriod: PeriodSchema.nullish().describe(
      "Fiscal period (YYYY-MM) whose IVA position to estimate from the libro IVA (débito − crédito − retenciones − IVA perceptions on purchases − last month's saldo a favor). Omit unless IVA to pay is asked.",
    ),
  }),
  run: (_ctx, input) => runTaxDocuments(input),
});
