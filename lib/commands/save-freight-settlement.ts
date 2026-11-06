import "server-only";

import type { z } from "zod";

import type { FreightSettlementSaveSchema } from "@/features/freight-settlements/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

/**
 * Creates a liquidación de fletes draft (no id) or replaces a draft's period,
 * notes and cargas, pricing each carga in save_freight_settlement (one
 * transaction), and audits it. The caller has already checked
 * `invoices:issue` and parsed the input with `FreightSettlementSaveSchema`:
 * the draft editor and an accepted assistant proposal.
 */
export async function saveFreightSettlement(
  actorId: string,
  d: z.output<typeof FreightSettlementSaveSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { data, error } = await getServiceClient().rpc(
    "save_freight_settlement",
    {
      p_client_id: d.client_id,
      p_period_start: d.period_start,
      p_period_end: d.period_end,
      p_shipment_ids: d.shipment_ids,
      p_notes: d.notes ?? "",
      p_user_id: actorId,
      ...(d.id ? { p_settlement_id: d.id } : {}),
    },
  );
  if (error || !data) {
    const guardError = mapDbGuardError(error, {
      slug: "freight_settlements.save.rejected",
      userId: actorId,
      id: d.id ?? null,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("freight_settlements.save.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo guardar la liquidación." };
  }

  await logAudit(
    d.id ? "freight_settlement.updated" : "freight_settlement.created",
    actorId,
    {
      client_id: d.client_id,
      period_start: d.period_start,
      period_end: d.period_end,
      shipments: d.shipment_ids.length,
    },
    data,
  );
  return { ok: true, data: { id: data } };
}
