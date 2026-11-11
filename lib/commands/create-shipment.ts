import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { ShipmentCreateSchema } from "@/features/shipments/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

/**
 * Inserts a carga and audits it. The caller has already checked `shipments:write`
 * and parsed the input with `ShipmentCreateSchema`: the carga dialog and an
 * accepted assistant proposal. `db` is the user's client (shipments' RLS).
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
      destination: d.destination ?? null,
      description: d.description ?? null,
      scheduled_date: d.scheduled_date ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("shipments.create.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo crear la carga." };
  }
  await logAudit("shipment.created", actorId, {}, data.id);
  return { ok: true, data: { id: data.id } };
}
