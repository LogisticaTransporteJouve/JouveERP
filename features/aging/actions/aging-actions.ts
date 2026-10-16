"use server";

import type { ActionResult } from "@/lib/query/run-action";
import {
  AGING_VIEW_AMOUNT_COLUMNS,
  aggregateClientAging,
  type AgingReport,
} from "@/lib/aging";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { fetchLatestUsdRate } from "@/lib/fx";
import { logger } from "@/lib/logger";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// Sorted by ARS-equivalent exposure so finance sees biggest debtors first.
// Aggregates across all channels (fiscal + interno).
export async function getAgingSummaryAction(): Promise<
  ActionResult<AgingReport>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver aging." };
  }

  const supabase = await createSupabaseClient();
  // Drained past max_rows (1000): a capped read would drop the smallest
  // debtors from the list AND from the grand totals.
  const [{ data, error }, usdRate] = await Promise.all([
    paginateRange((from, to) =>
      supabase
        .from("v_client_aging")
        .select(
          `client_id, ${AGING_VIEW_AMOUNT_COLUMNS}, clients!inner(legal_name, display_name, cuit)`,
        )
        .order("client_id", { ascending: true })
        .range(from, to),
    ),
    fetchLatestUsdRate(supabase),
  ]);

  if (error) {
    logger.error("aging.summary.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cargar el aging." };
  }

  return { ok: true, data: aggregateClientAging(data, usdRate) };
}
