import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import {
  IsoDateSchema,
  listWindowShape,
  UuidSchema,
} from "@/lib/validation/common";

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
  invoice_id: string | null;
  /** invoice_id points at an invoice that no longer bills the carga (a
   *  fiscal factura credited in full): it can be invoiced again. */
  invoice_void: boolean;
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

const optionalDate = z
  .union([
    z.literal(""),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  ])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** The longest remito number a carga holds (the scanned-remito search). */
export const REMITO_NUMBER_MAX = 60;

/** What the carga form writes: client, description, scheduled date and
 *  dirección (the destination column). An assistant proposal can also put
 *  the new carga on a trip. */
const shipmentFields = {
  client_id: optionalUuid,
  destination: optionalText(160),
  description: optionalText(500),
  scheduled_date: optionalDate,
};

export const ShipmentCreateSchema = z.object({
  ...shipmentFields,
  trip_id: optionalUuid,
});
export type ShipmentCreateInput = z.infer<typeof ShipmentCreateSchema>;

export const ShipmentUpdateSchema = z.object({
  id: z.string().uuid(),
  ...shipmentFields,
});

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

/** The statuses a carga can be moved to (never back to not_started). */
export const SHIPMENT_TARGET_STATUSES = [
  "in_progress",
  "delivered",
  "cancelled",
  "reprogrammed",
] as const satisfies readonly ShipmentStatus[];
export type ShipmentTargetStatus = (typeof SHIPMENT_TARGET_STATUSES)[number];

/** Where each status can go: the transitions change_shipment_status accepts
 *  and the cargas table offers. */
export const SHIPMENT_NEXT_STATUSES: Record<
  ShipmentStatus,
  readonly ShipmentTargetStatus[]
> = {
  not_started: ["in_progress", "delivered", "cancelled", "reprogrammed"],
  in_progress: ["delivered", "cancelled", "reprogrammed"],
  delivered: [],
  cancelled: ["reprogrammed"],
  reprogrammed: ["reprogrammed"],
};

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

/** Optional filters of the cargas list (dates on scheduled_date, so a carga
 *  without one is left out of a dated filter); none = every carga. */
export const ShipmentListFilterSchema = z.object({
  ...listWindowShape,
  /** One carga (the assistant's status-change proposal). */
  id: UuidSchema.nullish(),
  clientId: UuidSchema.nullish(),
  tripId: UuidSchema.nullish(),
  status: z.enum(SHIPMENT_STATUSES).nullish(),
  remito: z.string().trim().min(1).max(REMITO_NUMBER_MAX).nullish(),
});
export type ShipmentListFilter = z.input<typeof ShipmentListFilterSchema>;
