import "server-only";

import type { z } from "zod";

import type { ClientTariffCreateSchema } from "@/features/client-tariffs/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

/**
 * Inserts a client tariff and audits it; the overlap guard's message comes
 * back as the error. The caller has already checked `storage_billing:issue`
 * and parsed the input with `ClientTariffCreateSchema`: the tariff dialog and
 * an accepted assistant proposal.
 */
export async function createClientTariff(
  actorId: string,
  d: z.output<typeof ClientTariffCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { data, error } = await getServiceClient()
    .from("client_tariffs")
    .insert({
      client_id: d.client_id,
      concept: d.concept,
      unit: d.unit,
      price: d.price,
      currency: d.currency,
      valid_from: d.valid_from,
      valid_to: d.valid_to ?? null,
      notes: d.notes ?? null,
      area_id: d.area_id ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "client_tariffs.create.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("client_tariffs.create.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo crear la tarifa." };
  }

  await logAudit(
    "client_tariff.created",
    actorId,
    {
      client_id: d.client_id,
      concept: d.concept,
      unit: d.unit,
      price: d.price,
      currency: d.currency,
      valid_from: d.valid_from,
      valid_to: d.valid_to ?? null,
      area_id: d.area_id ?? null,
    },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
