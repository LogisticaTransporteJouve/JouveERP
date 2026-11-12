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
  companion_employee_id: string | null;
  driver: { full_name: string } | null;
  vehicle: { patente: string } | null;
  /** The Acompañante's name, read for whoever sees the trip (trips:read
   *  does not need hr:read). */
  companion: { legal_name: string } | null;
}

/** An active employee the trip form offers as Acompañante. */
export interface TripCompanionOption {
  id: string;
  legal_name: string;
}

const optionalUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const TripDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida.");

/** A trip's fields: date, status, driver, Acompañante and vehicle. */
export const TripCreateSchema = z.object({
  trip_date: TripDateSchema,
  driver_id: optionalUuid,
  companion_employee_id: optionalUuid,
  vehicle_id: optionalUuid,
  status: z.enum(TRIP_STATUSES).default("planned"),
});

export type TripCreateInput = z.infer<typeof TripCreateSchema>;

/** The most cargas «Nuevo viaje» puts on the trip at once. */
export const TRIP_SHIPMENTS_MAX = 100;

/** What «Nuevo viaje» sends: the trip plus the cargas without a trip it
 *  takes. */
export const TripCreateWithShipmentsSchema = TripCreateSchema.extend({
  shipment_ids: z.array(UuidSchema).max(TRIP_SHIPMENTS_MAX).default([]),
});

export const TripUpdateSchema = z.object({
  id: z.string().uuid(),
  trip_date: TripDateSchema.optional(),
  driver_id: optionalUuid,
  companion_employee_id: optionalUuid,
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
