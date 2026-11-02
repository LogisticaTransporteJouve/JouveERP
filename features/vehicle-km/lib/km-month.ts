import { round2 } from "@/lib/format";

import {
  needsKmReading,
  type KmReading,
  type VehicleKmMonth,
  type VehicleKmRow,
} from "../schema";

export type KmVehicle = {
  id: string;
  patente: string;
  alias: string | null;
  vehicle_type: string;
  is_active: boolean;
};

/** "2026-01" → "2025-12". */
export function previousPeriod(period: string): string {
  const [y = 0, m = 1] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * The month's grid: every active vehicle that needs a reading, plus any other
 * vehicle that has one this month, sorted by patente. `readings` holds every
 * reading up to `period` (later ones are ignored).
 */
export function buildKmMonth(
  period: string,
  vehicles: readonly KmVehicle[],
  readings: readonly KmReading[],
): VehicleKmMonth {
  const byVehicle = new Map<string, KmReading[]>();
  for (const r of readings) {
    if (r.period > period) continue;
    byVehicle.set(r.vehicle_id, [...(byVehicle.get(r.vehicle_id) ?? []), r]);
  }

  const rows: VehicleKmRow[] = [];
  for (const v of vehicles) {
    const own = byVehicle.get(v.id) ?? [];
    const reading = own.find((r) => r.period === period) ?? null;
    if (!reading && !(v.is_active && needsKmReading(v.vehicle_type))) continue;
    const previous =
      own
        .filter((r) => r.period < period)
        .sort((a, b) => b.period.localeCompare(a.period))[0] ?? null;
    rows.push({
      vehicle_id: v.id,
      patente: v.patente,
      alias: v.alias,
      vehicle_type: v.vehicle_type,
      is_active: v.is_active,
      reading,
      previous,
      driven: reading && previous ? round2(reading.km - previous.km) : null,
    });
  }
  rows.sort((a, b) => a.patente.localeCompare(b.patente));

  return {
    period,
    rows,
    missing: rows.filter(
      (r) => !r.reading && r.is_active && needsKmReading(r.vehicle_type),
    ).length,
  };
}
