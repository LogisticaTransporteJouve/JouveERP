import { z } from "zod";

import {
  IsoDateSchema,
  PeriodSchema,
  UuidSchema,
} from "@/lib/validation/common";

/** Towed vehicles carry no odometer: the monthly reading and its reminder
 *  skip them (the same list as sync_automatic_tasks' vehicle_km source). */
export const KM_EXEMPT_VEHICLE_TYPES = ["acoplado", "semi"] as const;

export function needsKmReading(vehicleType: string): boolean {
  return !(KM_EXEMPT_VEHICLE_TYPES as readonly string[]).includes(vehicleType);
}

/** numeric(10, 1) */
const MAX_KM = 999_999_999;

export const KmReadingSaveSchema = z.object({
  vehicle_id: UuidSchema,
  period: PeriodSchema,
  km: z
    .number({ message: "Ingresá los km." })
    .finite("Ingresá los km.")
    .min(0, "Los km no pueden ser negativos.")
    .max(MAX_KM, "Km fuera de rango."),
  read_on: IsoDateSchema,
  notes: z
    .string()
    .trim()
    .max(500, "Máx 500 caracteres.")
    .nullish()
    .transform((v) => (v ? v : null)),
});

export type KmReadingSaveInput = z.infer<typeof KmReadingSaveSchema>;

export const KmMonthInputSchema = z.object({ period: PeriodSchema });

export const KmReadingDeleteSchema = z.object({ id: UuidSchema });

export type KmReading = {
  id: string;
  vehicle_id: string;
  period: string;
  km: number;
  read_on: string;
  notes: string | null;
};

export type VehicleKmRow = {
  vehicle_id: string;
  patente: string;
  alias: string | null;
  vehicle_type: string;
  is_active: boolean;
  /** This month's reading, if loaded. */
  reading: KmReading | null;
  /** The latest reading of an earlier month. */
  previous: KmReading | null;
  /** reading − previous; null unless both exist. */
  driven: number | null;
};

export type VehicleKmMonth = {
  period: string;
  rows: VehicleKmRow[];
  /** Active vehicles that need a reading and have none this month. */
  missing: number;
};
