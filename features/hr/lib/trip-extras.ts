import "server-only";

import { getServiceClient } from "@/lib/supabase/service";

import type { TripForExtras } from "../account-schema";

const TRIPS_LIMIT = 2000;

export type EmployeeTrips = {
  /** Completed trips of the month per employee, oldest first. */
  byEmployee: Map<string, TripForExtras[]>;
  /** True when the month had more trips than were read. */
  partial: boolean;
};

/**
 * The completed trips of the month of each employee's driver records, with
 * their delivered shipments counted as unloadings. Service client: callers
 * gate with hr:read first, and the trips and drivers RLS leaves finance (who
 * runs the planilla) out.
 */
export async function readEmployeeTrips(
  employeeIds: readonly string[],
  year: number,
  month: number,
): Promise<EmployeeTrips> {
  const byEmployee = new Map<string, TripForExtras[]>();
  if (employeeIds.length === 0) return { byEmployee, partial: false };
  const supabase = getServiceClient();

  const { data: drivers, error: driversErr } = await supabase
    .from("drivers")
    .select("id, employee_id")
    .in("employee_id", [...employeeIds]);
  if (driversErr) throw new Error(`trip-extras drivers: ${driversErr.message}`);
  const employeeByDriver = new Map<string, string>();
  for (const d of drivers ?? []) {
    if (d.employee_id) employeeByDriver.set(d.id, d.employee_id);
  }
  if (employeeByDriver.size === 0) return { byEmployee, partial: false };

  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const { data: trips, error: tripsErr } = await supabase
    .from("trips")
    .select("id, trip_date, km, origin, destination, driver_id")
    .in("driver_id", [...employeeByDriver.keys()])
    .eq("status", "completed")
    .gte("trip_date", `${year}-${mm}-01`)
    .lte("trip_date", `${year}-${mm}-${String(lastDay).padStart(2, "0")}`)
    .order("trip_date")
    .order("id")
    .limit(TRIPS_LIMIT + 1);
  if (tripsErr) throw new Error(`trip-extras trips: ${tripsErr.message}`);
  const rows = (trips ?? []).slice(0, TRIPS_LIMIT);

  const unloads = new Map<string, number>();
  if (rows.length > 0) {
    const { data: shipments, error: shipErr } = await supabase
      .from("shipments")
      .select("trip_id")
      .in(
        "trip_id",
        rows.map((t) => t.id),
      )
      .eq("status", "delivered")
      .limit(TRIPS_LIMIT * 20);
    if (shipErr) throw new Error(`trip-extras shipments: ${shipErr.message}`);
    for (const s of shipments ?? []) {
      if (s.trip_id) unloads.set(s.trip_id, (unloads.get(s.trip_id) ?? 0) + 1);
    }
  }

  for (const t of rows) {
    const employeeId = t.driver_id ? employeeByDriver.get(t.driver_id) : null;
    if (!employeeId) continue;
    const list = byEmployee.get(employeeId) ?? [];
    list.push({
      id: t.id,
      trip_date: t.trip_date,
      km: t.km === null ? null : Number(t.km),
      origin: t.origin,
      destination: t.destination,
      unloads: unloads.get(t.id) ?? 0,
    });
    byEmployee.set(employeeId, list);
  }
  return { byEmployee, partial: (trips ?? []).length > TRIPS_LIMIT };
}
