import { z } from "zod";

import { listWindowShape, UuidSchema } from "@/lib/validation/common";

export const TRIP_STATUSES = [
  "planned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  planned: "Planificado",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
};

export function isTripStatus(v: unknown): v is TripStatus {
  return (
    typeof v === "string" && (TRIP_STATUSES as readonly string[]).includes(v)
  );
}

export interface Trip {
  id: string;
  trip_date: string;
  driver_id: string | null;
  vehicle_id: string | null;
  channel_id: string | null;
  origin: string | null;
  destination: string | null;
  cargo_description: string | null;
  status: TripStatus;
  km: number | null;
  revenue: number | null;
  cost: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  driver: { full_name: string } | null;
  vehicle: { patente: string } | null;
}

const optionalUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const TripDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida.");

/** What the trip form writes: date, status, driver and vehicle. */
export const TripCreateSchema = z.object({
  trip_date: TripDateSchema,
  driver_id: optionalUuid,
  vehicle_id: optionalUuid,
  status: z.enum(TRIP_STATUSES).default("planned"),
});

export type TripCreateInput = z.infer<typeof TripCreateSchema>;

export const TripUpdateSchema = z.object({
  id: z.string().uuid(),
  trip_date: TripDateSchema.optional(),
  driver_id: optionalUuid,
  vehicle_id: optionalUuid,
  status: z.enum(TRIP_STATUSES).optional(),
});

/** Optional filters of the trips list (by trip_date); none = every trip. */
export const TripListFilterSchema = z.object({
  ...listWindowShape,
  vehicleId: UuidSchema.nullish(),
  driverId: UuidSchema.nullish(),
});
export type TripListFilter = z.input<typeof TripListFilterSchema>;
