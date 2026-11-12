import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ASSIGNABLE_SHIPMENT_STATUSES } from "@/features/shipments/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Database } from "@/lib/db/database.types";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

/** The write landed but the cargas' status did not follow; the daily run
 *  still starts the ones whose trip date arrived. */
export const SHIPMENT_STATUS_SYNC_WARNING =
  "Se guardó, pero no se actualizó el estado de las cargas.";

/**
 * Brings the status of these cargas in line with their trip
 * (sync_shipment_trip_status): «En curso» on a trip dated today or earlier,
 * back to «No iniciada» when they left it. The caller has already checked
 * its own permission and written the change. Returns the warning to show when
 * the sync failed, else null; the write is never undone for it.
 */
export async function syncShipmentTripStatus(
  shipmentIds: readonly string[],
  actorId: string,
): Promise<string | null> {
  if (shipmentIds.length === 0) return null;
  const { error } = await getServiceClient().rpc("sync_shipment_trip_status", {
    p_shipment_ids: [...shipmentIds],
    p_actor: actorId,
  });
  if (error) {
    logger.error("shipments.status_sync.failed", { userId: actorId, error });
    return SHIPMENT_STATUS_SYNC_WARNING;
  }
  return null;
}

/**
 * Puts cargas on a trip, or takes them off it (tripId null), then syncs their
 * status. Assigning only takes cargas still without a trip in an assignable
 * status, so two people assigning at once cannot move a carga another trip
 * already took; `ids` are the cargas that moved. The caller has already
 * checked `shipments:write` (the cargas' assign dialog, «Nuevo viaje»); `db`
 * is the user's client (shipments' RLS).
 */
export async function setShipmentsTrip(
  db: SupabaseClient<Database>,
  actorId: string,
  { tripId, shipmentIds }: { tripId: string | null; shipmentIds: string[] },
): Promise<
  ActionResult<{ count: number; ids: string[]; warning: string | null }>
> {
  const base = db
    .from("shipments")
    .update({ trip_id: tripId })
    .in("id", shipmentIds);
  const { data, error } = await (
    tripId
      ? base.is("trip_id", null).in("status", [...ASSIGNABLE_SHIPMENT_STATUSES])
      : base
  ).select("id");
  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "shipments.trip_set.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("shipments.trip_set.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudieron actualizar las cargas." };
  }
  const ids = data.map((row) => row.id);
  for (const id of ids) {
    await logAudit("shipment.trip_set", actorId, { trip_id: tripId }, id);
  }
  const warning = await syncShipmentTripStatus(ids, actorId);
  return { ok: true, data: { count: ids.length, ids, warning } };
}
