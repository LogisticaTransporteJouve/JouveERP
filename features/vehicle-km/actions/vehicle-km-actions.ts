"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { buildKmRange } from "../lib/km-range";
import {
  KmDaysInputSchema,
  KmRangeInputSchema,
  type KmDay,
  type VehicleKmRange,
} from "../schema";

const DENIED = "No tenés permiso para ver los km.";

/** Flota → Km: each vehicle's km driven in a date range, from Strix. */
export async function getVehicleKmRangeAction(
  input: unknown,
): Promise<ActionResult<VehicleKmRange>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_km:read"))
    return { ok: false, error: DENIED };
  const parsed = KmRangeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Rango inválido.",
    };
  }
  const range = parsed.data;

  const service = getServiceClient();
  const [vehicles, daily] = await Promise.all([
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
        .from("vehicle_km_daily")
        .select("vehicle_id, day, km")
        .gte("day", range.from)
        .lte("day", range.to)
        .order("day")
        .order("vehicle_id")
        .range(from, to),
    ),
  ]);
  if (vehicles.error || daily.error) {
    logger.error("vehicle_km.range.failed", {
      userId: ctx.userId,
      error: vehicles.error ?? daily.error,
    });
    return { ok: false, error: "No se pudieron leer los km." };
  }

  return {
    ok: true,
    data: buildKmRange(
      range,
      vehicles.data,
      daily.data.map((d) => ({ ...d, km: Number(d.km) })),
    ),
  };
}

/** One vehicle's km per day in a range, newest first. */
export async function getVehicleKmDaysAction(
  input: unknown,
): Promise<ActionResult<KmDay[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_km:read"))
    return { ok: false, error: DENIED };
  const parsed = KmDaysInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Rango inválido.",
    };
  }
  const { vehicle_id, from, to } = parsed.data;
  const service = getServiceClient();
  const res = await paginateRange((a, b) =>
    service
      .from("vehicle_km_daily")
      .select("day, km")
      .eq("vehicle_id", vehicle_id)
      .gte("day", from)
      .lte("day", to)
      .order("day", { ascending: false })
      .range(a, b),
  );
  if (res.error) {
    logger.error("vehicle_km.days.failed", {
      userId: ctx.userId,
      error: res.error,
    });
    return { ok: false, error: "No se pudieron leer los km." };
  }
  return {
    ok: true,
    data: res.data.map((d) => ({ day: d.day, km: Number(d.km) })),
  };
}
