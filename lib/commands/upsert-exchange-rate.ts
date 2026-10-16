import "server-only";

import type { ExchangeRateCreateInput } from "@/features/exchange-rates/schema";
import { logAudit } from "@/lib/actions/audit";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/**
 * Saves a manual USD rate with the caller's session and audits it. An upsert:
 * a manual rate deliberately overrides the BCRA one for that date (the cron,
 * on the other hand, never overwrites an existing row). The caller has
 * already checked `accounting:write` and parsed the input with
 * `ExchangeRateCreateSchema`.
 */
export async function upsertManualExchangeRate(
  actorId: string,
  input: ExchangeRateCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exchange_rates")
    .upsert(
      {
        currency: "USD",
        rate_date: input.rate_date,
        rate: input.rate,
        source: "manual",
        notes: input.notes ?? null,
        // The overriding row carries its own creation timestamp instead of
        // inheriting the BCRA row's.
        created_at: new Date().toISOString(),
        created_by: actorId,
      },
      { onConflict: "currency,rate_date" },
    )
    .select("id")
    .single();
  if (error) {
    logger.error("exchange_rates.create.failed", {
      userId: actorId,
      rate_date: input.rate_date,
      error,
    });
    return { ok: false, error: "No se pudo guardar la cotización." };
  }
  await logAudit(
    "exchange_rate.upserted",
    actorId,
    { rate_date: input.rate_date, rate: input.rate, source: "manual" },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
