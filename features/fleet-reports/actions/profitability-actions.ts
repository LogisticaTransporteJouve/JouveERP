"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import {
  computeProfitability,
  type FleetProfitability,
  type FuelInput,
  type MaintenanceInput,
  type TripInput,
} from "../lib/profitability";

type RangeInput = { periodStart: string; periodEnd: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fleet profitability over a date range: per-trip net (revenue − cost − fuel)
 * and per-vehicle net (revenue − costs − fuel − maintenance). Aggregated in TS
 * (computeProfitability) over fully drained reads. Gated on trips:read (the
 * fleet read).
 */
export async function getFleetProfitabilityAction(
  input: RangeInput,
): Promise<ActionResult<FleetProfitability>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "trips:read")) {
    return { ok: false, error: "No tenés permiso para ver la rentabilidad." };
  }
  if (!DATE_RE.test(input.periodStart) || !DATE_RE.test(input.periodEnd)) {
    return { ok: false, error: "Rango de fechas inválido." };
  }

  const supabase = await createSupabaseClient();

  // Every read is drained past max_rows: the totals are summed in
  // computeProfitability, so a truncated page would be a wrong number.
  const [tripsRes, fuelRes, maintRes, vehiclesRes] = await Promise.all([
    paginateRange((from, to) =>
      supabase
        .from("trips")
        .select(
          "id, trip_date, vehicle_id, origin, destination, revenue, cost, vehicle:vehicles(patente), driver:drivers(full_name)",
        )
        .gte("trip_date", input.periodStart)
        .lte("trip_date", input.periodEnd)
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("fuel_loads")
        .select(
          "vehicle_id, trip_id, amount, purchase_invoice_id, transaction_id",
        )
        .gte("load_date", input.periodStart)
        .lte("load_date", input.periodEnd)
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("maintenance_records")
        .select("vehicle_id, cost, purchase_invoice_id, transaction_id")
        .gte("service_date", input.periodStart)
        .lte("service_date", input.periodEnd)
        .order("id")
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("vehicles")
        .select("id, patente")
        .order("id")
        .range(from, to),
    ),
  ]);

  const firstError =
    tripsRes.error ?? fuelRes.error ?? maintRes.error ?? vehiclesRes.error;
  if (firstError) {
    logger.error("fleet.profitability.failed", {
      userId: ctx.userId,
      error: firstError,
    });
    return { ok: false, error: "No se pudo calcular la rentabilidad." };
  }

  const trips: TripInput[] = (tripsRes.data ?? []).map((t) => ({
    id: t.id,
    trip_date: t.trip_date,
    vehicle_id: t.vehicle_id,
    origin: t.origin,
    destination: t.destination,
    revenue: t.revenue === null ? null : Number(t.revenue),
    cost: t.cost === null ? null : Number(t.cost),
    vehicle: t.vehicle,
    driver: t.driver,
  }));

  const fuel: FuelInput[] = (fuelRes.data ?? []).map((f) => ({
    vehicle_id: f.vehicle_id,
    trip_id: f.trip_id,
    amount: Number(f.amount),
    has_voucher: Boolean(f.purchase_invoice_id ?? f.transaction_id),
  }));

  const maintenance: MaintenanceInput[] = (maintRes.data ?? []).map((m) => ({
    vehicle_id: m.vehicle_id,
    cost: m.cost === null ? null : Number(m.cost),
    has_voucher: Boolean(m.purchase_invoice_id ?? m.transaction_id),
  }));

  const vehicleNames = new Map<string, string>();
  for (const v of vehiclesRes.data ?? []) vehicleNames.set(v.id, v.patente);

  return {
    ok: true,
    data: computeProfitability({ trips, fuel, maintenance, vehicleNames }),
  };
}
