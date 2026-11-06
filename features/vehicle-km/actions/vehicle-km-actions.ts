"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { saveVehicleKmReading } from "@/lib/commands/save-vehicle-km-reading";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { buildKmMonth } from "../lib/km-month";
import {
  KmMonthInputSchema,
  KmReadingDeleteSchema,
  KmReadingSaveSchema,
  type VehicleKmMonth,
} from "../schema";

const READING_COLUMNS = "id, vehicle_id, period, km, read_on, notes";

/** The month's grid (Flota → Km mensual): each active motor vehicle with its
 *  reading, the previous one and the km driven between them. */
export async function getVehicleKmMonthAction(
  input: unknown,
): Promise<ActionResult<VehicleKmMonth>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_km:read")) {
    return { ok: false, error: "No tenés permiso para ver los km." };
  }
  const parsed = KmMonthInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Período inválido." };
  const { period } = parsed.data;

  const service = getServiceClient();
  const [vehicles, readings] = await Promise.all([
    paginateRange((from, to) =>
      service
        .from("vehicles")
        .select("id, patente, alias, vehicle_type, is_active")
        .order("patente")
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      service
        .from("vehicle_km_readings")
        .select(READING_COLUMNS)
        .lte("period", period)
        .order("period", { ascending: false })
        .order("id")
        .range(from, to),
    ),
  ]);
  if (vehicles.error || readings.error) {
    logger.error("vehicle_km.month.failed", {
      userId: ctx.userId,
      error: vehicles.error ?? readings.error,
    });
    return { ok: false, error: "No se pudieron leer los km." };
  }

  return {
    ok: true,
    data: buildKmMonth(
      period,
      vehicles.data,
      readings.data.map((r) => ({ ...r, km: Number(r.km) })),
    ),
  };
}

/** Loads or corrects a vehicle's reading for a month (Km mensual). */
export async function saveVehicleKmReadingAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_km:write")) {
    return { ok: false, error: "No tenés permiso para cargar km." };
  }
  const parsed = KmReadingSaveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  return saveVehicleKmReading(getServiceClient(), ctx.userId, parsed.data);
}

export async function deleteVehicleKmReadingAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_km:write")) {
    return { ok: false, error: "No tenés permiso para borrar km." };
  }
  const parsed = KmReadingDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ID inválido." };

  const { data, error } = await getServiceClient()
    .from("vehicle_km_readings")
    .delete()
    .eq("id", parsed.data.id)
    .select("vehicle_id, period");
  if (error) {
    logger.error("vehicle_km.delete.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo borrar la lectura." };
  }
  const deleted = data[0];
  if (!deleted) return { ok: false, error: "La lectura ya no existe." };

  await logAudit(
    "vehicle_km.deleted",
    ctx.userId,
    { vehicle_id: deleted.vehicle_id, period: deleted.period },
    parsed.data.id,
  );
  return { ok: true, data: undefined };
}
