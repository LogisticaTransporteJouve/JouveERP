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
  in_progress: "En curso",
  delivered: "Entregada",
  cancelled: "Cancelada",
  reprogrammed: "Reprogramada",
};

/** «Tipo» of a carga. */
export const SHIPMENT_KINDS = ["retiro", "carga", "mudanza"] as const;
export type ShipmentKind = (typeof SHIPMENT_KINDS)[number];

export const SHIPMENT_KIND_LABELS: Record<ShipmentKind, string> = {
  retiro: "Retiro",
  carga: "Carga",
  mudanza: "Mudanza",
};

export function isShipmentKind(v: unknown): v is ShipmentKind {
  return (
    typeof v === "string" && (SHIPMENT_KINDS as readonly string[]).includes(v)
  );
}

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
  kind: ShipmentKind;
  /** «Dirección de carga». */
  origin: string | null;
  /** «Dirección de descarga». */
  destination: string | null;
  description: string | null;
  /** «Fecha de carga». */
  scheduled_date: string | null;
  /** «Fecha de descarga» (planned; on or after the load day). */
  unload_date: string | null;
  /** «Horario», free text («8 a 12 hs»). */
  time_window: string | null;
  status: ShipmentStatus;
  /** The day «Entregar» stamped. */
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

/** What the carga form writes: client, description, tipo, the load and
 *  unload addresses (origin / destination), the load and unload days
 *  (scheduled_date / unload_date), horario and observaciones (notes). An
 *  assistant proposal can also put the new carga on a trip. */
const shipmentFields = {
  client_id: optionalUuid,
  description: optionalText(500),
  origin: optionalText(160),
  destination: optionalText(160),
  scheduled_date: optionalDate,
  unload_date: optionalDate,
  time_window: optionalText(60),
  notes: optionalText(1000),
};

export const UNLOAD_BEFORE_LOAD_MESSAGE =
  "La fecha de descarga no puede ser anterior a la fecha de carga.";

/** The unload day, when both days are given, is on or after the load day
 *  (the database checks it too). */
function unloadAfterLoad(v: {
  scheduled_date?: string | null;
  unload_date?: string | null;
}): boolean {
  return (
    !v.scheduled_date || !v.unload_date || v.unload_date >= v.scheduled_date
  );
}

export const ShipmentCreateSchema = z
  .object({
    ...shipmentFields,
    kind: z.enum(SHIPMENT_KINDS).default("carga"),
    trip_id: optionalUuid,
  })
  .refine(unloadAfterLoad, {
    message: UNLOAD_BEFORE_LOAD_MESSAGE,
    path: ["unload_date"],
  });
export type ShipmentCreateInput = z.infer<typeof ShipmentCreateSchema>;

export const ShipmentUpdateSchema = z
  .object({
    id: z.string().uuid(),
    ...shipmentFields,
    kind: z.enum(SHIPMENT_KINDS).optional(),
  })
  .refine(unloadAfterLoad, {
    message: UNLOAD_BEFORE_LOAD_MESSAGE,
    path: ["unload_date"],
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

/** The statuses change_shipment_status accepts as a target (never
 *  not_started by hand; in_progress stays for older callers). */
export const SHIPMENT_TARGET_STATUSES = [
  "in_progress",
  "delivered",
  "cancelled",
  "reprogrammed",
] as const satisfies readonly ShipmentStatus[];
export type ShipmentTargetStatus = (typeof SHIPMENT_TARGET_STATUSES)[number];

/** What a user (the table, the assistant) can move a carga to: a carga
 *  starts by itself on its trip's date (sync_shipment_trip_status). */
export const OFFERED_SHIPMENT_TARGETS = [
  "delivered",
  "cancelled",
  "reprogrammed",
] as const satisfies readonly ShipmentTargetStatus[];
export type OfferedShipmentTarget = (typeof OFFERED_SHIPMENT_TARGETS)[number];

/** Where each status can go: the transitions change_shipment_status accepts.
 *  Reprogramming an in_progress carga sends it back to not_started, off its
 *  trip. */
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

/** Status transition: deliver / cancel / reprogram (start, for older
 *  callers). The relevant extra fields per status are validated/applied in
 *  the action and change_shipment_status. */
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
  /** Any of these statuses. */
  statuses: z
    .array(z.enum(SHIPMENT_STATUSES))
    .min(1)
    .max(SHIPMENT_STATUSES.length)
    .nullish(),
  /** true: on a trip; false: without one. */
  assigned: z.boolean().nullish(),
  /** Any of these tipos. */
  kinds: z
    .array(z.enum(SHIPMENT_KINDS))
    .min(1)
    .max(SHIPMENT_KINDS.length)
    .nullish(),
  remito: z.string().trim().min(1).max(REMITO_NUMBER_MAX).nullish(),
});
export type ShipmentListFilter = z.input<typeof ShipmentListFilterSchema>;
