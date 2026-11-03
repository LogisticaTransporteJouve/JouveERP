import { z } from "zod";

import { IsoDateSchema } from "@/lib/validation/common";

/** Mirrors freight_settlements.status. */
export const FREIGHT_SETTLEMENT_STATUSES = [
  "draft",
  "confirmed",
  "invoiced",
  "cancelled",
] as const;
export type FreightSettlementStatus =
  (typeof FREIGHT_SETTLEMENT_STATUSES)[number];

export const FREIGHT_SETTLEMENT_STATUS_LABELS: Record<
  FreightSettlementStatus,
  string
> = {
  draft: "Borrador",
  confirmed: "Confirmada",
  invoiced: "Facturada",
  cancelled: "Cancelada",
};

export function isFreightSettlementStatus(
  v: unknown,
): v is FreightSettlementStatus {
  return (
    typeof v === "string" &&
    (FREIGHT_SETTLEMENT_STATUSES as readonly string[]).includes(v)
  );
}

/** Mirrors freight_settlement_items.price_source. */
export const FREIGHT_PRICE_SOURCES = ["freight", "tariff"] as const;
export type FreightPriceSource = (typeof FREIGHT_PRICE_SOURCES)[number];

export const FREIGHT_PRICE_SOURCE_LABELS: Record<FreightPriceSource, string> = {
  freight: "Flete de la carga",
  tariff: "Tarifa del cliente",
};

export function isFreightPriceSource(v: unknown): v is FreightPriceSource {
  return (
    typeof v === "string" &&
    (FREIGHT_PRICE_SOURCES as readonly string[]).includes(v)
  );
}

/** "R-00000012": the number of a liquidación confirmed before the remito R
 *  (legacy rows keep it; new ones leave it null). */
export function formatSettlementNumber(numero: number | null): string {
  return numero === null ? "Borrador" : `R-${String(numero).padStart(8, "0")}`;
}

/** Mirrors freight_settlements.channel: the side it was confirmed on. */
export const FREIGHT_SETTLEMENT_CHANNELS = ["fiscal", "internal"] as const;
export type FreightSettlementChannel =
  (typeof FREIGHT_SETTLEMENT_CHANNELS)[number];

export function isFreightSettlementChannel(
  v: unknown,
): v is FreightSettlementChannel {
  return (
    typeof v === "string" &&
    (FREIGHT_SETTLEMENT_CHANNELS as readonly string[]).includes(v)
  );
}

/** "R9002-00000001": the Remito R of a fiscal liquidación. */
export function formatRemitoR(pos: number, numero: number): string {
  return `R${String(pos).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

type SettlementDocumentFields = Pick<
  FreightSettlement,
  | "status"
  | "numero"
  | "channel"
  | "remito_pos"
  | "remito_number"
  | "client_is_fiscal"
  | "invoice_number"
>;

/** The side its document follows: the one it was confirmed on, else (a
 *  draft or a legacy liquidación) its client's. */
export function settlementSide(
  s: Pick<FreightSettlement, "channel" | "client_is_fiscal">,
): FreightSettlementChannel {
  return s.channel ?? (s.client_is_fiscal ? "fiscal" : "internal");
}

/** The liquidación's document: "Remito R9002-00000001" (fiscal), "Remito
 *  interno X9001-00000004" (internal, once issued) or the legacy
 *  "Liquidación R-00000012". Null while it has none. */
export function settlementDocumentLabel(
  s: SettlementDocumentFields,
): string | null {
  if (s.remito_pos !== null && s.remito_number !== null) {
    return `Remito ${formatRemitoR(s.remito_pos, s.remito_number)}`;
  }
  if (s.numero !== null) {
    return `Liquidación ${formatSettlementNumber(s.numero)}`;
  }
  if (settlementSide(s) === "internal" && s.invoice_number) {
    return `Remito interno ${s.invoice_number}`;
  }
  return null;
}

/** The short number for the list: the remito R, the legacy R-…, the remito
 *  interno X, "Borrador", or "Sin remito" (internal, X not issued yet). */
export function settlementNumberLabel(s: SettlementDocumentFields): string {
  if (s.remito_pos !== null && s.remito_number !== null) {
    return formatRemitoR(s.remito_pos, s.remito_number);
  }
  if (s.numero !== null) return formatSettlementNumber(s.numero);
  if (s.status === "draft") return "Borrador";
  if (settlementSide(s) === "internal" && s.invoice_number) {
    return s.invoice_number;
  }
  return "Sin remito";
}

/** True when it prints as an R: a Remito R, or a legacy R-…. An internal
 *  liquidación prints as its remito interno X. */
export function hasRDocument(
  s: Pick<FreightSettlement, "numero" | "remito_number">,
): boolean {
  return s.numero !== null || s.remito_number !== null;
}

/** What a live liquidación offers next: confirm (fiscal draft → Remito R),
 *  invoice (fiscal, R emitted → Factura A/B) or issue_internal (internal →
 *  remito interno X, confirming first if needed; the final step). */
export type FreightSettlementStep = "confirm" | "invoice" | "issue_internal";

export function settlementNextStep(
  s: Pick<
    FreightSettlement,
    "status" | "channel" | "client_is_fiscal" | "invoice_id"
  >,
): FreightSettlementStep | null {
  const fiscal = settlementSide(s) === "fiscal";
  if (s.status === "draft") return fiscal ? "confirm" : "issue_internal";
  if (s.status === "confirmed" && s.invoice_id === null) {
    return fiscal ? "invoice" : "issue_internal";
  }
  return null;
}

export interface FreightSettlement {
  id: string;
  /** Legacy R-00000012 number (confirmed before the remito R). */
  numero: number | null;
  /** Side it was confirmed on; null on a draft or a legacy liquidación. */
  channel: FreightSettlementChannel | null;
  /** Remito R point of sale and number (fiscal side). */
  remito_pos: number | null;
  remito_number: number | null;
  client_id: string;
  client_name: string;
  /** Ventas (true) or Otras ventas: the invoice's channel side. */
  client_is_fiscal: boolean;
  period_start: string;
  period_end: string;
  status: FreightSettlementStatus;
  total: number;
  invoice_id: string | null;
  /** The grouped invoice's own status (draft/emitting/emitted/…), if any. */
  invoice_status: string | null;
  /** "A0003-00000045" / "X9001-00000004" of a live (not failed or
   *  cancelled) grouped invoice; null otherwise. */
  invoice_number: string | null;
  /** True while its invoice is being issued (claim not stale). */
  invoicing: boolean;
  notes: string | null;
  created_at: string;
}

export interface FreightSettlementItem {
  id: string;
  shipment_id: string;
  remito_number: string | null;
  service_date: string | null;
  origin: string | null;
  destination: string | null;
  description: string | null;
  /** The carga's own channel: the invoice must use it when set. */
  channel_id: string | null;
  amount: number;
  price_source: FreightPriceSource;
}

export interface FreightSettlementDetail extends FreightSettlement {
  items: FreightSettlementItem[];
}

/** A carga the liquidación can take; amount null = no flete and no tariff. */
export interface FreightSettlementCandidate {
  shipment_id: string;
  remito_number: string | null;
  service_date: string | null;
  origin: string | null;
  destination: string | null;
  description: string | null;
  amount: number | null;
  price_source: FreightPriceSource | null;
}

const optionalNotes = z
  .string()
  .trim()
  .max(1000, "Máx 1000 caracteres.")
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

const PeriodFields = z.object({
  client_id: z.string().uuid("Elegí un cliente."),
  period_start: IsoDateSchema,
  period_end: IsoDateSchema,
});

function checkPeriod(
  d: { period_start: string; period_end: string },
  ctx: z.RefinementCtx,
): void {
  if (d.period_end < d.period_start) {
    ctx.addIssue({
      code: "custom",
      message: "El período termina antes de empezar.",
      path: ["period_end"],
    });
  }
}

export const FreightCandidatesSchema = PeriodFields.extend({
  settlement_id: z.string().uuid().nullable().optional(),
}).superRefine(checkPeriod);
export type FreightCandidatesInput = z.input<typeof FreightCandidatesSchema>;

/** Creates a draft (no id) or replaces a draft's period, notes and cargas. */
export const FreightSettlementSaveSchema = PeriodFields.extend({
  id: z.string().uuid().nullable().optional(),
  shipment_ids: z
    .array(z.string().uuid())
    .min(1, "Elegí al menos una carga.")
    .max(500, "Hasta 500 cargas por liquidación."),
  notes: optionalNotes,
}).superRefine(checkPeriod);
export type FreightSettlementSaveInput = z.input<
  typeof FreightSettlementSaveSchema
>;

export const FreightSettlementIdSchema = z.object({
  id: z.string().uuid(),
});

/** "Facturar" / "Emitir remito interno": the grouped invoice's channel and
 *  point of sale. */
export const FreightSettlementInvoiceSchema = z.object({
  id: z.string().uuid(),
  channel_id: z.string().min(1, "Elegí un canal."),
  punto_venta: z.coerce
    .number()
    .int()
    .min(1, "Elegí un punto de venta.")
    .max(99999),
});
export type FreightSettlementInvoiceInput = z.input<
  typeof FreightSettlementInvoiceSchema
>;

/** One invoice line per carga: "Flete Rosario → Córdoba · Remito 0001-123 ·
 *  12/10/2026". */
export function freightItemDescription(item: {
  origin: string | null;
  destination: string | null;
  remito_number: string | null;
  service_date: string | null;
}): string {
  const route = [item.origin, item.destination].filter(Boolean).join(" → ");
  const parts = [route ? `Flete ${route}` : "Flete"];
  if (item.remito_number) parts.push(`Remito ${item.remito_number}`);
  if (item.service_date) {
    const [y, m, d] = item.service_date.split("-");
    parts.push(`${d}/${m}/${y}`);
  }
  return parts.join(" · ");
}
