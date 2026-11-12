import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { TripCreateSchema } from "@/features/trips/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

/**
 * Null when `companionId` is an active employee (or there is none), else the
 * error to show. Read with the service client: whoever writes trips picks an
 * Acompañante without hr:read, and only the yes/no leaves this function.
 */
export async function checkTripCompanion(
  companionId: string | null | undefined,
  actorId: string,
): Promise<string | null> {
  if (!companionId) return null;
  const { data, error } = await getServiceClient()
    .from("employees")
    .select("id")
    .eq("id", companionId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    logger.error("trips.companion_check.failed", { userId: actorId, error });
    return "No se pudo verificar el acompañante.";
  }
  return data ? null : "El acompañante no es un empleado activo.";
}

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
  const companionError = await checkTripCompanion(
    d.companion_employee_id,
    actorId,
  );
  if (companionError) return { ok: false, error: companionError };

  const { data, error } = await db
    .from("trips")
    .insert({
      trip_date: d.trip_date,
      driver_id: d.driver_id ?? null,
      companion_employee_id: d.companion_employee_id ?? null,
      vehicle_id: d.vehicle_id ?? null,
      status: d.status,
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
