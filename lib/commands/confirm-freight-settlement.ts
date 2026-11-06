import "server-only";

import {
  formatRemitoR,
  formatSettlementNumber,
  isFreightSettlementChannel,
  type FreightSettlementChannel,
} from "@/features/freight-settlements/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

export type ConfirmedSettlement = {
  channel: FreightSettlementChannel | null;
  /** "R9002-00000001" (fiscal), the legacy "R-00000012", or null (internal:
   *  its document is the remito interno X issued next). */
  number: string | null;
};

/**
 * Reprices a liquidación de fletes draft and confirms it on its client's
 * side (confirm_freight_settlement_document, one transaction), and audits
 * it. Confirming twice returns the same result. With `expectedTotal` (an
 * accepted assistant proposal, which showed that total) the database
 * refuses, rolling back, when repricing gives another one.
 *
 * The caller has already checked `invoices:issue`: the Confirmar menu, the
 * remito interno step of invoiceFreightSettlementAction and the proposal.
 */
export async function confirmFreightSettlement(
  actorId: string,
  id: string,
  expectedTotal?: number,
): Promise<ActionResult<ConfirmedSettlement>> {
  const { data, error } = await getServiceClient()
    .rpc("confirm_freight_settlement_document", {
      p_settlement_id: id,
      p_user_id: actorId,
      ...(expectedTotal !== undefined
        ? { p_expected_total: expectedTotal }
        : {}),
    })
    .maybeSingle();
  if (error || !data) {
    const guardError = mapDbGuardError(error, {
      slug: "freight_settlements.confirm.rejected",
      userId: actorId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("freight_settlements.confirm.failed", {
      userId: actorId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo confirmar la liquidación." };
  }
  const channel = isFreightSettlementChannel(data.channel)
    ? data.channel
    : null;
  const number =
    data.remito_pos !== null && data.remito_number !== null
      ? formatRemitoR(data.remito_pos, data.remito_number)
      : data.numero !== null
        ? formatSettlementNumber(data.numero)
        : null;

  await logAudit(
    "freight_settlement.confirmed",
    actorId,
    { channel, numero: number },
    id,
  );
  return { ok: true, data: { channel, number } };
}
