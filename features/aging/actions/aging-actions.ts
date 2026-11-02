"use server";

import type { ActionResult } from "@/lib/query/run-action";
import {
  AGING_VIEW_AMOUNT_COLUMNS,
  CLIENT_AGING_EXTRA_COLUMNS,
  aggregateClientAging,
  onAccountFromRows,
  type AgingReport,
} from "@/lib/aging";
import { requireUserContext } from "@/lib/auth/context";
import { CLIENT_AGING_PERMISSIONS, userCanAll } from "@/lib/auth/permissions";
import { fetchLatestUsdRate } from "@/lib/fx";
import { logger } from "@/lib/logger";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

const CLIENT_AGING_SELECT = `client_id, ${AGING_VIEW_AMOUNT_COLUMNS}, ${CLIENT_AGING_EXTRA_COLUMNS}, clients!inner(legal_name, display_name, cuit)`;

// Sorted by ARS-equivalent exposure so finance sees biggest debtors first.
// `isFiscal` null reads every channel (v_client_aging); a boolean reads that
// scope only (v_client_aging_by_scope, one row per client).
export async function getAgingSummaryAction(input?: {
  isFiscal?: boolean | null;
}): Promise<ActionResult<AgingReport>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, CLIENT_AGING_PERMISSIONS)) {
    return { ok: false, error: "No tenés permiso para ver aging." };
  }

  const isFiscal = input?.isFiscal ?? null;
  const supabase = await createSupabaseClient();
  // Drained past max_rows (1000): a capped read would drop the smallest
  // debtors from the list AND from the grand totals.
  const [{ data, error }, usdRate, unapplied] = await Promise.all([
    isFiscal === null
      ? paginateRange((from, to) =>
          supabase
            .from("v_client_aging")
            .select(CLIENT_AGING_SELECT)
            .order("client_id", { ascending: true })
            .range(from, to),
        )
      : paginateRange((from, to) =>
          applyFiscalFilter(
            supabase
              .from("v_client_aging_by_scope")
              .select(CLIENT_AGING_SELECT),
            isFiscal,
          )
            .order("client_id", { ascending: true })
            .range(from, to),
        ),
    fetchLatestUsdRate(supabase),
    // What each client paid a cuenta and is not applied yet: shown apart
    // from the buckets.
    paginateRange((from, to) =>
      applyFiscalFilter(
        supabase
          .from("v_receipt_unapplied")
          .select(
            "party_id:client_id, currency, unapplied_amount, party:clients!inner(legal_name, display_name, cuit)",
          ),
        isFiscal,
      )
        .order("receipt_id", { ascending: true })
        .range(from, to),
    ),
  ]);

  if (error || unapplied.error) {
    logger.error("aging.summary.failed", {
      userId: ctx.userId,
      error: error ?? unapplied.error,
    });
    return { ok: false, error: "No se pudo cargar el aging." };
  }

  return {
    ok: true,
    data: aggregateClientAging(
      data,
      usdRate,
      onAccountFromRows(unapplied.data),
    ),
  };
}
