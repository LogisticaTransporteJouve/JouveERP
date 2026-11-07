"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

import {
  RECONCILIATION_DETAIL_LIMIT,
  ReconciliationIssueSchema,
  ReconciliationMonthSchema,
  ReconciliationPeriodSchema,
  groupIssues,
  periodRange,
  type ReconciliationDetail,
  type ReconciliationMonth,
} from "../lib/arca-reconciliation";

const DENIED = "No tenés permiso para ver los comprobantes recibidos de ARCA.";
const FAILED = "No se pudo armar la conciliación con ARCA.";
const TIMED_OUT =
  "La conciliación con ARCA tardó demasiado en armarse. Probá de nuevo en un rato.";

/** Postgres statement_timeout. */
function failure(error: { code?: string }): string {
  return error.code === "57014" ? TIMED_OUT : FAILED;
}

/** ARCA vs ERP totals per month (ARS, NC negative). */
export async function getArcaReconciliationMonthsAction(): Promise<
  ActionResult<ReconciliationMonth[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const { data, error } = await getServiceClient().rpc(
    "purchase_arca_reconciliation_months",
  );
  if (error) {
    logger.error("arca_reconciliation.months.failed", { error: error.message });
    return { ok: false, error: failure(error) };
  }
  const parsed = z.array(ReconciliationMonthSchema).safeParse(data ?? []);
  if (!parsed.success) {
    logger.error("arca_reconciliation.months.unexpected_shape", {
      issues: parsed.error.issues.slice(0, 3),
    });
    return { ok: false, error: FAILED };
  }
  return { ok: true, data: parsed.data };
}

const DetailInputSchema = z.object({ period: ReconciliationPeriodSchema });

/** The vouchers only in ARCA, the purchases only in the ERP and the pairs
 *  whose total differs, for a year or a month. */
export async function getArcaReconciliationDetailAction(
  input: unknown,
): Promise<ActionResult<ReconciliationDetail>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:write")) {
    return { ok: false, error: DENIED };
  }
  const parsedInput = DetailInputSchema.safeParse(input);
  if (!parsedInput.success) return { ok: false, error: "Período inválido." };
  const { from, to } = periodRange(parsedInput.data.period);

  const { data, error } = await getServiceClient().rpc(
    "purchase_arca_reconciliation_detail",
    { p_from: from, p_to: to, p_limit: RECONCILIATION_DETAIL_LIMIT },
  );
  if (error) {
    logger.error("arca_reconciliation.detail.failed", { error: error.message });
    return { ok: false, error: failure(error) };
  }
  const parsed = z.array(ReconciliationIssueSchema).safeParse(data ?? []);
  if (!parsed.success) {
    logger.error("arca_reconciliation.detail.unexpected_shape", {
      issues: parsed.error.issues.slice(0, 3),
    });
    return { ok: false, error: FAILED };
  }
  return { ok: true, data: groupIssues(parsed.data) };
}
