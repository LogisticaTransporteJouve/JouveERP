import { z } from "zod";

import { getMonthlyPackageStatusAction } from "@/features/monthly-package/actions/monthly-package-actions";
import { needsAttention } from "@/features/monthly-package/schema";
import { PeriodSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, okResult } from "../result";

// Read tool over Contabilidad › Paquete del mes: wraps
// getMonthlyPackageStatusAction, so it keeps its accounting:read gate and
// its fiscal-only counts.

export async function runMonthlyPackageStatus(input: {
  period: string;
}): Promise<AiRunResult> {
  const res = await getMonthlyPackageStatusAction(input.period);
  if (!res.ok) return errResult(res.error);
  const s = res.data;
  const counts = [
    s.pendingJournal,
    s.missingJournal,
    s.invoicesDraft,
    s.invoicesEmitting,
    s.invoicesFailed,
    s.caeaUninformed,
    s.purchasesWithoutLetter,
  ];
  const unread = counts.filter((c) => c === null).length;
  const open = counts.filter((c) => c !== null && needsAttention(c)).length;
  return okResult(
    `${s.period}: ${s.closedReadFailed ? "closing unread" : s.closedAt ? "closed" : "open"}; ` +
      `${open} checks need attention` +
      (unread > 0 ? `, ${unread} could not be read.` : "."),
    s,
    { partial: unread > 0 || s.closedReadFailed },
  );
}

export const getMonthlyPackageStatus = defineAiAction({
  name: "getMonthlyPackageStatus",
  domain: "contabilidad",
  permission: "accounting:read",
  sideEffect: "read",
  sources: [
    "accounting_closed_periods",
    "pending_journal_entries",
    "journal_missing_entries",
    "invoices",
    "purchase_invoices_fiscal_without_letter",
  ],
  description:
    "Month-end checklist for the accountant (Paquete del mes): whether the " +
    "period is closed, entries pending or missing, fiscal comprobantes not " +
    "authorized (draft, emitting, failed), CAEA not informed and fiscal " +
    "purchases without a letter. Null counts could not be read.",
  input: z.object({
    period: PeriodSchema.describe("Accounting period (YYYY-MM)."),
  }),
  run: (_ctx, input) => runMonthlyPackageStatus(input),
});
