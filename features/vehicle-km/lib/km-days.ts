import { round2 } from "@/lib/format";

import type { DriverKmDays, KmDay, KmPerson, VehicleKmDay } from "../schema";

/** Every day with km or with a trip, newest first, with the day's drivers
 *  once each. */
export function buildVehicleKmDays(
  daily: readonly KmDay[],
  trips: readonly { day: string; driver: KmPerson | null }[],
): VehicleKmDay[] {
  const days = new Map<string, VehicleKmDay>();
  const at = (day: string) => {
    const found = days.get(day);
    if (found) return found;
    const fresh: VehicleKmDay = { day, km: null, drivers: [] };
    days.set(day, fresh);
    return fresh;
  };
  for (const d of daily) at(d.day).km = d.km;
  for (const t of trips) {
    const row = at(t.day);
    if (t.driver && !row.drivers.some((p) => p.id === t.driver?.id)) {
      row.drivers.push(t.driver);
    }
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/** A driver's trips, newest first, each with its vehicle's km that day. */
export function buildDriverKmDays(
  trips: readonly {
    id: string;
    day: string;
    origin: string | null;
    destination: string | null;
    vehicle: { id: string; patente: string } | null;
  }[],
  daily: readonly { vehicle_id: string; day: string; km: number }[],
): DriverKmDays {
  const km = new Map(daily.map((d) => [`${d.vehicle_id}|${d.day}`, d.km]));
  const counted = new Set<string>();
  let total = 0;
  const rows = trips
    .map((t) => {
      const key = t.vehicle ? `${t.vehicle.id}|${t.day}` : null;
      const dayKm = key ? (km.get(key) ?? null) : null;
      if (key && dayKm !== null && !counted.has(key)) {
        counted.add(key);
        total += dayKm;
      }
      const route = [t.origin, t.destination].filter(Boolean).join(" → ");
      return {
        trip_id: t.id,
        day: t.day,
        vehicle: t.vehicle,
        route: route === "" ? null : route,
        km: dayKm,
      };
    })
    .sort((a, b) => b.day.localeCompare(a.day));
  return { trips: rows, total: round2(total) };
}
