"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { buildDriverKmDays, buildVehicleKmDays } from "../lib/km-days";
import { buildKmRange } from "../lib/km-range";
import {
  DriverKmDaysInputSchema,
  KmDaysInputSchema,
  KmRangeInputSchema,
  type DriverKmDays,
  type VehicleKmDay,
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

const TRIP_LIVE = ["planned", "in_progress", "completed"];

/** One vehicle's days in a range, newest first: its km by Strix and, for a
 *  caller who can see trips, who drove it by the day's trips. */
export async function getVehicleKmDaysAction(
  input: unknown,
): Promise<ActionResult<VehicleKmDay[]>> {
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
  const seesTrips = userCan(ctx.access, "trips:read");
  const service = getServiceClient();
  const [daily, trips] = await Promise.all([
    paginateRange((a, b) =>
      service
        .from("vehicle_km_daily")
        .select("day, km")
        .eq("vehicle_id", vehicle_id)
        .gte("day", from)
        .lte("day", to)
        .order("day", { ascending: false })
        .range(a, b),
    ),
    seesTrips
      ? paginateRange((a, b) =>
          service
            .from("trips")
            .select("id, trip_date, driver:drivers(id, full_name)")
            .eq("vehicle_id", vehicle_id)
            .in("status", TRIP_LIVE)
            .gte("trip_date", from)
            .lte("trip_date", to)
            .order("trip_date")
            .order("id")
            .range(a, b),
        )
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (daily.error || trips.error) {
    logger.error("vehicle_km.days.failed", {
      userId: ctx.userId,
      error: daily.error ?? trips.error,
    });
    return { ok: false, error: "No se pudieron leer los km." };
  }
  return {
    ok: true,
    data: buildVehicleKmDays(
      daily.data.map((d) => ({ day: d.day, km: Number(d.km) })),
      trips.data.map((t) => ({ day: t.trip_date, driver: t.driver })),
    ),
  };
}

/** A driver's trips in a range, each with the km its vehicle did that day. */
export async function getDriverKmDaysAction(
  input: unknown,
): Promise<ActionResult<DriverKmDays>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, ["fleet_km:read", "trips:read"]))
    return { ok: false, error: DENIED };
  const parsed = DriverKmDaysInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Rango inválido.",
    };
  }
  const { driver_id, from, to } = parsed.data;
  const service = getServiceClient();
  const trips = await paginateRange((a, b) =>
    service
      .from("trips")
      .select(
        "id, trip_date, origin, destination, vehicle:vehicles(id, patente)",
      )
      .eq("driver_id", driver_id)
      .in("status", TRIP_LIVE)
      .gte("trip_date", from)
      .lte("trip_date", to)
      .order("trip_date")
      .order("id")
      .range(a, b),
  );
  if (trips.error) {
    logger.error("vehicle_km.driver_days.failed", {
      userId: ctx.userId,
      error: trips.error,
    });
    return { ok: false, error: "No se pudieron leer los viajes." };
  }
  const vehicleIds = [
    ...new Set(trips.data.flatMap((t) => (t.vehicle ? [t.vehicle.id] : []))),
  ];
  const daily =
    vehicleIds.length === 0
      ? { data: [], error: null }
      : await paginateRange((a, b) =>
          service
            .from("vehicle_km_daily")
            .select("vehicle_id, day, km")
            .in("vehicle_id", vehicleIds)
            .gte("day", from)
            .lte("day", to)
            .order("day")
            .order("vehicle_id")
            .range(a, b),
        );
  if (daily.error) {
    logger.error("vehicle_km.driver_days.failed", {
      userId: ctx.userId,
      error: daily.error,
    });
    return { ok: false, error: "No se pudieron leer los km." };
  }
  return {
    ok: true,
    data: buildDriverKmDays(
      trips.data.map((t) => ({
        id: t.id,
        day: t.trip_date,
        origin: t.origin,
        destination: t.destination,
        vehicle: t.vehicle,
      })),
      daily.data.map((d) => ({ ...d, km: Number(d.km) })),
    ),
  };
}
