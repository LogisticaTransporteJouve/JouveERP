import "server-only";

import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import type { TripForExtras } from "../account-schema";

/** Most trips read for one month; past it the read is flagged partial. */
export const TRIPS_LIMIT = 2000;

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
  // PostgREST caps every response at max_rows (1000): drain both reads.
  const trips = await paginateRange<{
    id: string;
    trip_date: string;
    km: number | null;
    origin: string | null;
    destination: string | null;
    driver_id: string | null;
  }>((from, to) =>
    supabase
      .from("trips")
      .select("id, trip_date, km, origin, destination, driver_id")
      .in("driver_id", [...employeeByDriver.keys()])
      .eq("status", "completed")
      .gte("trip_date", `${year}-${mm}-01`)
      .lte("trip_date", `${year}-${mm}-${String(lastDay).padStart(2, "0")}`)
      .order("trip_date")
      .order("id")
      .range(from, to),
  );
  if (trips.error) throw new Error(`trip-extras trips: ${trips.error.message}`);
  const rows = trips.data.slice(0, TRIPS_LIMIT);

  const unloads = new Map<string, number>();
  const shipments = await fetchInChunks(
    rows.map((t) => t.id),
    (ids) =>
      paginateRange<{ trip_id: string | null }>((from, to) =>
        supabase
          .from("shipments")
          .select("trip_id")
          .in("trip_id", ids)
          .eq("status", "delivered")
          .order("id")
          .range(from, to),
      ),
  );
  if (shipments.error) {
    throw new Error(`trip-extras shipments: ${shipments.error.message}`);
  }
  for (const s of shipments.data) {
    if (s.trip_id) unloads.set(s.trip_id, (unloads.get(s.trip_id) ?? 0) + 1);
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
  return { byEmployee, partial: trips.data.length > TRIPS_LIMIT };
}
