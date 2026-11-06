import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { TripCreateSchema } from "@/features/trips/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

/**
 * Inserts a trip and audits it. The caller has already checked `trips:write`
 * and parsed the input with `TripCreateSchema`: the trip dialog and an
 * accepted assistant proposal. `db` is the user's client, so trips' RLS
 * applies as it did in the action.
 */
export async function createTrip(
  db: SupabaseClient<Database>,
  actorId: string,
  d: z.output<typeof TripCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { data, error } = await db
    .from("trips")
    .insert({
      trip_date: d.trip_date,
      driver_id: d.driver_id ?? null,
      vehicle_id: d.vehicle_id ?? null,
      channel_id: d.channel_id ?? null,
      origin: d.origin ?? null,
      destination: d.destination ?? null,
      cargo_description: d.cargo_description ?? null,
      status: d.status,
      km: d.km ?? null,
      revenue: d.revenue ?? null,
      cost: d.cost ?? null,
      notes: d.notes ?? null,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("trips.create.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo crear el viaje." };
  }

  await logAudit("trip.created", actorId, { trip_date: d.trip_date }, data.id);
  return { ok: true, data: { id: data.id } };
}
