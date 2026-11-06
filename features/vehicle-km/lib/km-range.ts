import { round2 } from "@/lib/format";

import type { KmDay, VehicleKmRange, VehicleKmRow } from "../schema";

export type KmVehicle = {
  id: string;
  patente: string;
  alias: string | null;
  vehicle_type: string;
  is_active: boolean;
};

export type KmDailyRow = KmDay & { vehicle_id: string };

/** Towed vehicles carry no GPS of their own: the grid skips them unless
 *  Strix reported km for one. */
const NO_KM_TYPES: readonly string[] = ["acoplado", "semi"];

/**
 * The range's grid: every active motor vehicle, plus any other vehicle with
 * km in the range, with its km, days with km and last day, sorted by
 * patente.
 */
export function buildKmRange(
  range: { from: string; to: string },
  vehicles: readonly KmVehicle[],
  daily: readonly KmDailyRow[],
): VehicleKmRange {
  const byVehicle = new Map<string, KmDay[]>();
  for (const d of daily) {
    if (d.day < range.from || d.day > range.to) continue;
    byVehicle.set(d.vehicle_id, [...(byVehicle.get(d.vehicle_id) ?? []), d]);
  }

  const rows: VehicleKmRow[] = [];
  for (const v of vehicles) {
    const own = byVehicle.get(v.id) ?? [];
    if (
      own.length === 0 &&
      !(v.is_active && !NO_KM_TYPES.includes(v.vehicle_type))
    ) {
      continue;
    }
    const withKm = own.filter((d) => d.km > 0);
    rows.push({
      vehicle_id: v.id,
      patente: v.patente,
      alias: v.alias,
      vehicle_type: v.vehicle_type,
      is_active: v.is_active,
      km: round2(own.reduce((s, d) => s + d.km, 0)),
      days: withKm.length,
      last_day:
        withKm.map((d) => d.day).sort((a, b) => b.localeCompare(a))[0] ?? null,
    });
  }
  rows.sort((a, b) => a.patente.localeCompare(b.patente));

  return {
    from: range.from,
    to: range.to,
    rows,
    total: round2(rows.reduce((s, r) => s + r.km, 0)),
  };
}
