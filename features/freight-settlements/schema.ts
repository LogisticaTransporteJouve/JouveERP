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

/** "R-00000012": the liquidación's internal document number. */
export function formatSettlementNumber(numero: number | null): string {
  return numero === null ? "Borrador" : `R-${String(numero).padStart(8, "0")}`;
}

export interface FreightSettlement {
  id: string;
  numero: number | null;
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

/** "Facturar": the grouped invoice's channel and point of sale. */
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
