"use server";

import { periodBounds, periodOf } from "@/lib/accounting-period";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import {
  MonthlyPackagePeriodSchema,
  type CheckCount,
  type MonthlyPackageStatus,
} from "../schema";

type CountResult = { count: number | null; error: unknown };

/** The count, or null (logged) when the read failed. */
function countOf(
  res: CountResult,
  check: string,
  userId: string,
  period: string,
): CheckCount {
  if (res.error) {
    logger.warn("monthly_package.check_failed", {
      userId,
      period,
      check,
      error: res.error,
    });
    return null;
  }
  return res.count ?? 0;
}

/**
 * The month's checklist before handing it to the accountant: whether the
 * period is closed, entries still pending or missing, comprobantes not
 * authorized, CAEA not informed and fiscal purchases without a letter. Reads
 * through the service client (journal_missing_entries and the fiscal-letter
 * check run only as service_role) and only over fiscal channels, so a
 * fiscal_reader sees nothing of the internal side.
 */
export async function getMonthlyPackageStatusAction(
  period: string,
): Promise<ActionResult<MonthlyPackageStatus>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return { ok: false, error: "No tenés permiso para ver la contabilidad." };
  }
  const parsed = MonthlyPackagePeriodSchema.safeParse(period);
  if (!parsed.success) {
    return { ok: false, error: "Período inválido (YYYY-MM)." };
  }
  period = parsed.data;
  const { from, to } = periodBounds(period);
  const service = getServiceClient();

  const fiscalInvoices = (status: string) =>
    service
      .from("invoices")
      .select("id, channel:invoicing_channels!inner(is_fiscal)", {
        count: "exact",
        head: true,
      })
      .eq("channel.is_fiscal", true)
      .eq("status", status)
      .gte("fecha", from)
      .lte("fecha", to);

  const [
    closed,
    pending,
    missing,
    draft,
    emitting,
    failed,
    caea,
    withoutLetter,
  ] = await Promise.all([
    service
      .from("accounting_closed_periods")
      .select("closed_at")
      .eq("period", period)
      .maybeSingle(),
    service
      .from("pending_journal_entries")
      .select("source_id", { count: "exact", head: true })
      .eq("accrual_period", period),
    service.rpc("journal_missing_entries"),
    fiscalInvoices("draft"),
    fiscalInvoices("emitting"),
    fiscalInvoices("failed"),
    service
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("emission_type", "caea")
      .eq("status", "emitted")
      .is("caea_informed_at", null)
      .gte("fecha", from)
      .lte("fecha", to),
    service.rpc("purchase_invoices_fiscal_without_letter"),
  ]);

  if (closed.error) {
    logger.warn("monthly_package.check_failed", {
      userId: ctx.userId,
      period,
      check: "closed",
      error: closed.error,
    });
  }
  const lettersMissing = withoutLetter.data?.filter(
    (r) => r.status !== "cancelled" && periodOf(r.fecha) === period,
  );
  const check = (res: CountResult, name: string) =>
    countOf(res, name, ctx.userId, period);

  return {
    ok: true,
    data: {
      period,
      closedAt: closed.data?.closed_at ?? null,
      closedReadFailed: Boolean(closed.error),
      pendingJournal: check(pending, "pending"),
      missingJournal: check(
        { count: missing.data?.length ?? null, error: missing.error },
        "missing",
      ),
      invoicesDraft: check(draft, "draft"),
      invoicesEmitting: check(emitting, "emitting"),
      invoicesFailed: check(failed, "failed"),
      caeaUninformed: check(caea, "caea"),
      purchasesWithoutLetter: check(
        { count: lettersMissing?.length ?? null, error: withoutLetter.error },
        "without_letter",
      ),
    },
  };
}
