import "server-only";

import { getServiceClient } from "@/lib/supabase/service";

import {
  detectFleetDocExpiry,
  detectLossTrips,
  type FleetDocRow,
  type FleetFinding,
  type TripMarginRow,
} from "./detect";

const TRIP_LOOKBACK_DAYS = 180;

function minus(days: number, today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function first<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Reads fleet documents + trips (with tied fuel) and runs the deterministic
 *  detectors. Gated implicitly by the service-role read in the analyst cron. */
export async function gatherFleetInsights(
  today: string,
): Promise<FleetFinding[]> {
  const service = getServiceClient();

  const { data: docs } = await service
    .from("fleet_documents")
    .select(
      "id, kind, expires_at, vehicle:vehicles(patente), driver:drivers(full_name)",
    );
  const docRows: FleetDocRow[] = (docs ?? []).map((d) => {
    const vehicle = first(d.vehicle);
    const driver = first(d.driver);
    const who = vehicle?.patente ?? driver?.full_name ?? "—";
    return { id: d.id, expires_at: d.expires_at, label: `${who} (${d.kind})` };
  });

  const { data: trips } = await service
    .from("trips")
    .select("id, trip_date, origin, destination, revenue, cost")
    .gte("trip_date", minus(TRIP_LOOKBACK_DAYS, today));
  const { data: fuel } = await service
    .from("fuel_loads")
    .select("trip_id, amount")
    .not("trip_id", "is", null);

  const fuelByTrip = new Map<string, number>();
  for (const f of fuel ?? []) {
    if (!f.trip_id) continue;
    fuelByTrip.set(
      f.trip_id,
      (fuelByTrip.get(f.trip_id) ?? 0) + Number(f.amount ?? 0),
    );
  }

  const tripRows: TripMarginRow[] = (trips ?? []).map((t) => {
    const route =
      [t.origin, t.destination].filter(Boolean).join(" → ") || "viaje";
    return {
      id: t.id,
      label: `${t.trip_date} ${route}`,
      net:
        Number(t.revenue ?? 0) -
        Number(t.cost ?? 0) -
        (fuelByTrip.get(t.id) ?? 0),
    };
  });

  return [
    ...detectFleetDocExpiry(docRows, today),
    ...detectLossTrips(tripRows),
  ];
}
