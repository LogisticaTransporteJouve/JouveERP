"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  aggregateClientAging,
  type AgingSummaryResult,
  type AgingViewRow,
} from "../schema";

// Sorted by total_open desc so finance sees biggest debtors first.
// Aggregates across all channels (fiscal + interno).
export async function getAgingSummaryAction(): Promise<
  ActionResult<AgingSummaryResult>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver aging." };
  }

  const supabase = await createSupabaseClient();
  // Drained past max_rows (1000). The old `.limit(500)` silently dropped the
  // smallest debtors from the list AND from the grand totals.
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("v_client_aging")
      .select(
        "client_id, bucket_0_30, bucket_30_60, bucket_60_90, bucket_90_plus, total_open, document_count, oldest_days, clients!inner(legal_name, display_name, cuit)",
      )
      .order("total_open", { ascending: false })
      .order("client_id", { ascending: true })
      .range(from, to),
  );

  if (error) {
    logger.error("aging.summary.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cargar el aging." };
  }

  const result = aggregateClientAging((data ?? []) as AgingViewRow[]);
  return { ok: true, data: result };
}
