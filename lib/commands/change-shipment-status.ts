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
import { syncShipmentTripStatus } from "./set-shipments-trip";

/**
 * Changes a carga's status (start / deliver / cancel / reprogram) and records
 * the transition in its history, in one transaction (change_shipment_status).
 * Deliver stamps delivery_date (today when not given), cancel/reprogram store
 * the reason, reprogram with a new date leaves the current trip and can go on
 * a trip of that date (`trip_id`, then the status sync). The caller has
 * already checked `shipments:write` (and `trips:write` for `trip_id`) and
 * parsed the input with
 * `ShipmentStatusChangeSchema`: the status dialog and an accepted assistant
 * proposal. `db` must be the user's client: the RPC is SECURITY INVOKER and
 * the history row carries auth.uid().
 */
export async function changeShipmentStatus(
  db: SupabaseClient<Database>,
  actorId: string,
  d: z.output<typeof ShipmentStatusChangeSchema>,
): Promise<ActionResult<{ warning: string | null }>> {
  const {
    id,
    status,
    comment,
    delivery_date,
    failure_reason,
    scheduled_date,
    trip_id,
  } = d;
  // A reprogram with its new date leaves the current trip and, when asked,
  // goes on a trip of that date: one transaction (reprogram_shipment).
  const reprogram = status === "reprogrammed" && !!scheduled_date;
  if (trip_id && !reprogram) {
    return {
      ok: false,
      error:
        "Solo una carga reprogramada con su nueva fecha se asigna a un viaje.",
    };
  }
  const { data: from, error } = reprogram
    ? await db.rpc("reprogram_shipment", {
        p_id: id,
        p_scheduled_date: scheduled_date,
        p_failure_reason: failure_reason ?? undefined,
        p_comment: comment ?? undefined,
        p_trip_id: trip_id ?? undefined,
      })
    : await db.rpc("change_shipment_status", {
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
    // Not found, a transition that no longer applies, a refused trip, or a
    // carga in a live liquidación or rendición, which keeps its status.
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

  await logAudit(
    "shipment.status_changed",
    actorId,
    { from, to: status, ...(trip_id ? { trip_id } : {}) },
    id,
  );
  // On a trip of today it starts at once («En curso»); a failed sync is a
  // warning, the daily run still starts it.
  const warning = trip_id ? await syncShipmentTripStatus([id], actorId) : null;
  return { ok: true, data: { warning } };
}
