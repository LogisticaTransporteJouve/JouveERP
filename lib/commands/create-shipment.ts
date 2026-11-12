import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { ShipmentCreateSchema } from "@/features/shipments/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

import { syncShipmentTripStatus } from "./set-shipments-trip";

/**
 * Inserts a carga and audits it. The caller has already checked `shipments:write`
 * and parsed the input with `ShipmentCreateSchema`: the carga dialog and an
 * accepted assistant proposal. `db` is the user's client (shipments' RLS).
 * A carga born on a trip dated today or earlier starts at once (a failed
 * sync is logged; the daily run starts it).
 */
export async function createShipment(
  db: SupabaseClient<Database>,
  actorId: string,
  d: z.output<typeof ShipmentCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { data, error } = await db
    .from("shipments")
    .insert({
      client_id: d.client_id ?? null,
      trip_id: d.trip_id ?? null,
      kind: d.kind,
      origin: d.origin ?? null,
      destination: d.destination ?? null,
      description: d.description ?? null,
      scheduled_date: d.scheduled_date ?? null,
      unload_date: d.unload_date ?? null,
      time_window: d.time_window ?? null,
      notes: d.notes ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("shipments.create.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo crear la carga." };
  }
  await logAudit("shipment.created", actorId, {}, data.id);
  if (d.trip_id) await syncShipmentTripStatus([data.id], actorId);
  return { ok: true, data: { id: data.id } };
}
