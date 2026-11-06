import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { ShipmentStatusChangeSchema } from "@/features/shipments/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Database } from "@/lib/db/database.types";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

import { REMITO_TAKEN_ERROR, isRemitoTaken } from "./shipment-remito";

/**
 * Changes a carga's status (start / deliver / cancel / reprogram) and records
 * the transition in its history, in one transaction (change_shipment_status).
 * Deliver stamps delivery_date (today when not given), cancel/reprogram store
 * the reason, reprogram can set a new scheduled date. The caller has already
 * checked `shipments:write` and parsed the input with
 * `ShipmentStatusChangeSchema`: the status dialog and an accepted assistant
 * proposal. `db` must be the user's client: the RPC is SECURITY INVOKER and
 * the history row carries auth.uid().
 */
export async function changeShipmentStatus(
  db: SupabaseClient<Database>,
  actorId: string,
  d: z.output<typeof ShipmentStatusChangeSchema>,
): Promise<ActionResult> {
  const { id, status, comment, delivery_date, failure_reason, scheduled_date } =
    d;
  const { data: from, error } = await db.rpc("change_shipment_status", {
    p_id: id,
    p_status: status,
    p_comment: comment ?? undefined,
    p_delivery_date:
      status === "delivered" ? (delivery_date ?? todayInAR()) : undefined,
    p_failure_reason: failure_reason ?? undefined,
    p_scheduled_date: scheduled_date ?? undefined,
  });
  // Out of cancelled, the carga takes its remito number back.
  if (isRemitoTaken(error)) {
    return { ok: false, error: REMITO_TAKEN_ERROR };
  }
  if (error) {
    // Not found, a transition that no longer applies, or a carga in a live
    // liquidación or rendición, which keeps its status.
    const guardError = mapDbGuardError(error, {
      slug: "shipments.status.rejected",
      userId: actorId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("shipments.status.update_failed", {
      userId: actorId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo cambiar el estado." };
  }

  await logAudit("shipment.status_changed", actorId, { from, to: status }, id);
  return { ok: true, data: undefined };
}
