import "server-only";

import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { must } from "../gather";
import {
  detectFleetDocExpiry,
  detectLossTrips,
  type FleetDocRow,
  type FleetFinding,
  type TripMarginRow,
} from "./detect";

// Every read is drained (PostgREST stops at max_rows) and a failed one
// throws: the analyst keeps the previous cards of that kind instead of
// deleting them on a figure that silently became empty.

const TRIP_LOOKBACK_DAYS = 180;

function minus(days: number, today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function first<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Fleet documents about to expire (or expired). */
export async function gatherFleetDocExpiry(
  today: string,
): Promise<FleetFinding[]> {
  const service = getServiceClient();
  const docs = must(
    await paginateRange((from, to) =>
      service
        .from("fleet_documents")
        .select(
          "id, kind, expires_at, vehicle:vehicles(patente), driver:drivers(full_name)",
        )
        .order("id", { ascending: true })
        .range(from, to),
    ),
    "fleet.fleet_documents",
  );
  const docRows: FleetDocRow[] = docs.map((d) => {
    const vehicle = first(d.vehicle);
    const driver = first(d.driver);
    const who = vehicle?.patente ?? driver?.full_name ?? "—";
    return { id: d.id, expires_at: d.expires_at, label: `${who} (${d.kind})` };
  });
  return detectFleetDocExpiry(docRows, today);
}

/** Trips of the last 180 days whose revenue minus cost and tied fuel is a
 *  loss. Same equation as «Rentabilidad de flota»: the revenue comes from
 *  v_trip_revenue (invoiced freight, else the manual figure) and cancelled
 *  trips are left out. A trip with cargas still to invoice is not judged
 *  (detectLossTrips). */
export async function gatherTripMargins(
  today: string,
): Promise<FleetFinding[]> {
  const service = getServiceClient();
  const trips = must(
    await paginateRange((from, to) =>
      service
        .from("trips")
        .select("id, trip_date, origin, destination, cost")
        .gte("trip_date", minus(TRIP_LOOKBACK_DAYS, today))
        .neq("status", "cancelled")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    "fleet.trips",
  );
  const tripIds = trips.map((t) => t.id);
  // Only the revenue and fuel of these trips, each chunk drained.
  const revenue = must(
    await fetchInChunks(tripIds, (ids) =>
      paginateRange((from, to) =>
        service
          .from("v_trip_revenue")
          .select("trip_id, revenue, uninvoiced_shipments")
          .in("trip_id", ids)
          .order("trip_id", { ascending: true })
          .range(from, to),
      ),
    ),
    "fleet.v_trip_revenue",
  );
  const fuel = must(
    await fetchInChunks(tripIds, (ids) =>
      paginateRange((from, to) =>
        service
          .from("fuel_loads")
          .select("id, trip_id, amount")
          .in("trip_id", ids)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ),
    "fleet.fuel_loads",
  );

  const revenueByTrip = new Map<
    string,
    { revenue: number; uninvoiced: number }
  >();
  for (const r of revenue) {
    if (!r.trip_id) continue;
    revenueByTrip.set(r.trip_id, {
      revenue: Number(r.revenue ?? 0),
      // A count: a shipment priced by tariff has no freight until invoiced.
      uninvoiced: Number(r.uninvoiced_shipments ?? 0),
    });
  }
  const fuelByTrip = new Map<string, number>();
  for (const f of fuel) {
    if (!f.trip_id) continue;
    fuelByTrip.set(
      f.trip_id,
      (fuelByTrip.get(f.trip_id) ?? 0) + Number(f.amount ?? 0),
    );
  }

  const tripRows: TripMarginRow[] = [];
  for (const t of trips) {
    const tripRevenue = revenueByTrip.get(t.id);
    // A trip missing from the view was deleted between the reads; it is
    // left out rather than judged on a revenue of 0.
    if (tripRevenue === undefined) continue;
    const route =
      [t.origin, t.destination].filter(Boolean).join(" → ") || "viaje";
    tripRows.push({
      id: t.id,
      label: `${t.trip_date} ${route}`,
      net:
        tripRevenue.revenue - Number(t.cost ?? 0) - (fuelByTrip.get(t.id) ?? 0),
      pendingInvoicing: tripRevenue.uninvoiced > 0,
    });
  }
  return detectLossTrips(tripRows);
}
