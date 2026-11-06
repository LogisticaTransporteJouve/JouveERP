import { z } from "zod";

import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

const RANGE_ORDER = "La fecha desde no puede ser posterior a la fecha hasta.";

/** A date range (inclusive), from before to. */
export const KmRangeInputSchema = z
  .object({ from: IsoDateSchema, to: IsoDateSchema })
  .refine((r) => r.from <= r.to, RANGE_ORDER);

export type KmRangeInput = z.infer<typeof KmRangeInputSchema>;

export const KmDaysInputSchema = z
  .object({ vehicle_id: UuidSchema, from: IsoDateSchema, to: IsoDateSchema })
  .refine((r) => r.from <= r.to, RANGE_ORDER);

export type KmDaysInput = z.infer<typeof KmDaysInputSchema>;

export const DriverKmDaysInputSchema = z
  .object({ driver_id: UuidSchema, from: IsoDateSchema, to: IsoDateSchema })
  .refine((r) => r.from <= r.to, RANGE_ORDER);

export const StrixCredentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Ingresá el usuario de Strix.")
    .max(200, "Máx 200 caracteres."),
  password: z
    .string()
    .max(200, "Máx 200 caracteres.")
    .transform((v) => (v === "" ? null : v)),
});

export type StrixCredentialsInput = z.input<typeof StrixCredentialsSchema>;

export type KmDay = { day: string; km: number };

export type KmPerson = { id: string; full_name: string };

/** A vehicle's day: its km by Strix (null when Strix has none) and who
 *  drove it, by the day's trips. */
export type VehicleKmDay = {
  day: string;
  km: number | null;
  drivers: KmPerson[];
};

/** A driver's trip, with the km its vehicle did that whole day. */
export type DriverKmTrip = {
  trip_id: string;
  day: string;
  vehicle: { id: string; patente: string } | null;
  route: string | null;
  km: number | null;
};

export type DriverKmDays = {
  trips: DriverKmTrip[];
  /** Km of each vehicle-day once, however many trips share it. */
  total: number;
};

export type VehicleKmRow = {
  vehicle_id: string;
  patente: string;
  alias: string | null;
  vehicle_type: string;
  is_active: boolean;
  /** Km driven in the range, by Strix. */
  km: number;
  /** Days with km in the range. */
  days: number;
  /** The last day with km in the range. */
  last_day: string | null;
};

export type VehicleKmRange = {
  from: string;
  to: string;
  rows: VehicleKmRow[];
  total: number;
};
