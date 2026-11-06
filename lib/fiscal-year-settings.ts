import "server-only";

import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

/**
 * The month the fiscal year starts in (accounting_settings, one row). Reads
 * through the service client: the caller has already gated its own read
 * (accounting:read, management:read). A failed read is an error, not the
 * default: guessing the month would silently move «el ejercicio».
 */
export async function readFiscalYearStartMonth(
  userId: string,
): Promise<ActionResult<number>> {
  const { data, error } = await getServiceClient()
    .from("accounting_settings")
    .select("fiscal_year_start_month")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) {
    logger.error("accounting_settings.read.failed", {
      userId,
      error: error ?? "missing row",
    });
    return {
      ok: false,
      error: "No se pudo leer el inicio del ejercicio.",
    };
  }
  return { ok: true, data: data.fiscal_year_start_month };
}
