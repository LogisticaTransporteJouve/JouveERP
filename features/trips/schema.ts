import { z } from "zod";

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

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const optionalChannel = z
  .string()
  .trim()
  .max(60)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

const optionalAmount = z
  .union([z.literal(""), z.coerce.number().min(0)])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const TripCreateSchema = z.object({
  trip_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  driver_id: optionalUuid,
  vehicle_id: optionalUuid,
  channel_id: optionalChannel,
  origin: optionalText(160),
  destination: optionalText(160),
  cargo_description: optionalText(500),
  status: z.enum(TRIP_STATUSES).default("planned"),
  km: optionalAmount,
  revenue: optionalAmount,
  cost: optionalAmount,
  notes: optionalText(2000),
});

export type TripCreateInput = z.infer<typeof TripCreateSchema>;

export const TripUpdateSchema = z.object({
  id: z.string().uuid(),
  trip_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida.")
    .optional(),
  driver_id: optionalUuid,
  vehicle_id: optionalUuid,
  channel_id: optionalChannel,
  origin: optionalText(160),
  destination: optionalText(160),
  cargo_description: optionalText(500),
  status: z.enum(TRIP_STATUSES).optional(),
  km: optionalAmount,
  revenue: optionalAmount,
  cost: optionalAmount,
  notes: optionalText(2000),
});
