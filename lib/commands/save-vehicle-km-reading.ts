import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { KmReadingSaveSchema } from "@/features/vehicle-km/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Database } from "@/lib/db/database.types";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

/**
 * Loads or corrects a vehicle's reading for a month (one per month) and
 * audits it; a future month or reading date is refused. A reading below the
 * previous month's is accepted: the screen (and the proposal card) warns.
 * The caller has already checked `fleet_km:write` and parsed the input with
 * `KmReadingSaveSchema`: the Km mensual grid and an accepted assistant
 * proposal. `db` is the service client, as in the action.
 */
export async function saveVehicleKmReading(
  db: SupabaseClient<Database>,
  actorId: string,
  d: z.output<typeof KmReadingSaveSchema>,
): Promise<ActionResult<{ id: string }>> {
  const today = todayInAR();
  if (d.period > today.slice(0, 7)) {
    return { ok: false, error: "No se puede cargar el km de un mes futuro." };
  }
  if (d.read_on > today) {
    return { ok: false, error: "La fecha de lectura no puede ser futura." };
  }

  const { data, error } = await db
    .from("vehicle_km_readings")
    .upsert(
      {
        vehicle_id: d.vehicle_id,
        period: d.period,
        km: d.km,
        read_on: d.read_on,
        notes: d.notes,
        loaded_by: actorId,
      },
      { onConflict: "vehicle_id,period" },
    )
    .select("id")
    .single();
  if (error) {
    logger.error("vehicle_km.save.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo guardar el km." };
  }

  await logAudit(
    "vehicle_km.saved",
    actorId,
    { vehicle_id: d.vehicle_id, period: d.period, km: d.km },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
