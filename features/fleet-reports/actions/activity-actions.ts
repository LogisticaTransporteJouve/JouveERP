"use server";

import { gatedRead } from "@/lib/actions/gated-read";
import { userCan } from "@/lib/auth/permissions";
import type { ActionResult } from "@/lib/query/run-action";

import {
  FleetActivityInputSchema,
  type DriverActivityRow,
  type VehicleActivityRow,
} from "../schema";

/**
 * Activity per vehicle over a date range (ai_vehicle_activity, security
 * invoker): trips and their km for trips:read; fuel liters, odometer km and
 * the revenue of trips without a vehicle only when the user also reads fuel,
 * the km readings and shipments, so a denied part comes back NULL, not 0.
 */
export async function getVehicleActivityAction(
  input: unknown,
): Promise<ActionResult<VehicleActivityRow[]>> {
  return gatedRead({
    permissions: ["trips:read"],
    denied: "No tenés permiso para ver los viajes.",
    failure: "No se pudo calcular la actividad por vehículo.",
    schema: FleetActivityInputSchema,
    input,
    event: "fleet.vehicle_activity.failed",
    query: (supabase, v, access) =>
      supabase.rpc("ai_vehicle_activity", {
        p_from: v.from,
        p_to: v.to,
        p_include_fuel: userCan(access, "fuel:read"),
        p_include_km: userCan(access, "fleet_km:read"),
        p_include_revenue: userCan(access, "shipments:read"),
      }),
  });
}

/**
 * Activity per driver over a date range (ai_driver_activity, security
 * invoker): trips and km for trips:read; the linked employee's extras,
 * advances and account balance only with hr:read.
 */
export async function getDriverActivityAction(
  input: unknown,
): Promise<ActionResult<DriverActivityRow[]>> {
  return gatedRead({
    permissions: ["trips:read"],
    denied: "No tenés permiso para ver los viajes.",
    failure: "No se pudo calcular la actividad por chofer.",
    schema: FleetActivityInputSchema,
    input,
    event: "fleet.driver_activity.failed",
    query: (supabase, v, access) =>
      supabase.rpc("ai_driver_activity", {
        p_from: v.from,
        p_to: v.to,
        p_include_hr: userCan(access, "hr:read"),
      }),
  });
}
