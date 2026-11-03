import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import { IsoDateSchema } from "@/lib/validation/common";

export const SHIPMENT_STATUSES = [
  "not_started",
  "in_progress",
  "delivered",
  "cancelled",
  "reprogrammed",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  not_started: "No iniciada",
  in_progress: "En progreso",
  delivered: "Entregada",
  cancelled: "Cancelada",
  reprogrammed: "Reprogramada",
};

export function isShipmentStatus(v: unknown): v is ShipmentStatus {
  return (
    typeof v === "string" &&
    (SHIPMENT_STATUSES as readonly string[]).includes(v)
  );
}

export interface Shipment {
  id: string;
  client_id: string | null;
  trip_id: string | null;
  channel_id: string | null;
  remito_number: string | null;
  origin: string | null;
  destination: string | null;
  description: string | null;
  scheduled_date: string | null;
  status: ShipmentStatus;
  delivery_date: string | null;
  failure_reason: string | null;
  freight_amount: number | null;
  /** Cash on delivery: what the driver collects at delivery (null = no). */
  cod_amount: number | null;
  invoice_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  client: {
    legal_name: string;
    display_name: string | null;
    cuit: string | null;
    iva_condition: string | null;
    is_fiscal: boolean;
  } | null;
  trip: { trip_date: string } | null;
}

export interface ShipmentHistoryEntry {
  id: string;
  old_status: string | null;
  new_status: string;
  comment: string | null;
  changed_at: string;
  changed_by: string | null;
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

/** Empty = not cash-on-delivery; otherwise a positive amount
 *  (shipments_cod_amount_positive). */
const optionalCodAmount = z
  .union([
    z.literal(""),
    z.coerce.number().positive("El monto a cobrar tiene que ser mayor a 0."),
  ])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalDate = z
  .union([
    z.literal(""),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  ])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** The client's remito number: unique per client among live cargas
 *  (shipments_client_remito_unique), compared trimmed and case-insensitive. */
export const REMITO_NUMBER_MAX = 60;

export const ShipmentCreateSchema = z.object({
  client_id: optionalUuid,
  trip_id: optionalUuid,
  channel_id: optionalChannel,
  remito_number: optionalText(REMITO_NUMBER_MAX),
  origin: optionalText(160),
  destination: optionalText(160),
  description: optionalText(500),
  scheduled_date: optionalDate,
  freight_amount: optionalAmount,
  cod_amount: optionalCodAmount,
  notes: optionalText(2000),
});
export type ShipmentCreateInput = z.infer<typeof ShipmentCreateSchema>;

export const ShipmentUpdateSchema = z.object({
  id: z.string().uuid(),
  client_id: optionalUuid,
  trip_id: optionalUuid,
  channel_id: optionalChannel,
  remito_number: optionalText(REMITO_NUMBER_MAX),
  origin: optionalText(160),
  destination: optionalText(160),
  description: optionalText(500),
  scheduled_date: optionalDate,
  freight_amount: optionalAmount,
  cod_amount: optionalCodAmount,
  notes: optionalText(2000),
});

/** The duplicate check the carga form runs before saving. */
export const ShipmentRemitoCheckSchema = z.object({
  client_id: z.string().uuid(),
  remito_number: z.string().trim().min(1).max(REMITO_NUMBER_MAX),
  exclude_id: z.string().uuid().nullable().optional(),
});
export type ShipmentRemitoCheckInput = z.input<
  typeof ShipmentRemitoCheckSchema
>;

/** A live carga of the client that already holds a remito number. */
export interface ShipmentRemitoConflict {
  id: string;
  scheduled_date: string | null;
  status: string;
  origin: string | null;
  destination: string | null;
}

/** Assigns cargas to a trip (tripId) or takes them off it (null). */
export const ShipmentTripAssignSchema = z.object({
  tripId: z.string().uuid().nullable(),
  shipmentIds: z.array(z.string().uuid()).min(1).max(100),
});

/** Statuses a carga can still be put on a trip in. */
export const ASSIGNABLE_SHIPMENT_STATUSES = [
  "not_started",
  "reprogrammed",
] as const satisfies readonly ShipmentStatus[];

/** Status transition: start / deliver / cancel / reprogram. The relevant extra
 *  fields per status are validated/applied in the action. */
export const ShipmentStatusChangeSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(SHIPMENT_STATUSES),
  comment: optionalText(1000),
  delivery_date: optionalDate,
  failure_reason: optionalText(1000),
  scheduled_date: optionalDate,
});
export type ShipmentStatusChangeInput = z.infer<
  typeof ShipmentStatusChangeSchema
>;

/** Input for "facturar flete": which shipment, on which channel + POS. */
export const FreightInvoiceSchema = z.object({
  shipmentId: z.string().uuid(),
  channel_id: z.string().min(1),
  punto_venta: z.coerce.number().int().min(1).max(99999),
});
export type FreightInvoiceInput = z.infer<typeof FreightInvoiceSchema>;

/** Input of the shipments summary read; `.describe()` doubles as the
 *  assistant's tool parameter docs. */
export const ShipmentsSummaryInputSchema = z
  .object({
    from: IsoDateSchema.describe("Fecha desde, YYYY-MM-DD."),
    to: IsoDateSchema.describe("Fecha hasta, YYYY-MM-DD (inclusive)."),
  })
  .refine(
    (v) => v.from <= v.to,
    "La fecha desde es posterior a la fecha hasta.",
  );

export type ShipmentsSummaryRow =
  Database["public"]["Functions"]["ai_shipments_summary"]["Returns"][number];
