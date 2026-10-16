import { z } from "zod";

import {
  CONCEPTO,
  CONDICION_IVA_RECEPTOR,
  DOC_TIPO,
  IVA_RATE,
  MONEDA,
  ivaRatePercent,
  type InvoiceKind,
  type InvoiceLetter,
} from "@/lib/afip/codes";
import type { Database } from "@/lib/db/database.types";
import { round2 } from "@/lib/format";

// --------------------------------------------------------------------------
// Enums and constants surfaced for the form layer.
// --------------------------------------------------------------------------

export const INVOICE_KINDS = ["factura", "nc", "nd"] as const;

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  factura: "Factura",
  nc: "Nota de Crédito",
  nd: "Nota de Débito",
};

export const INVOICE_STATUSES = [
  "draft",
  "emitting",
  "emitted",
  "failed",
  "cancelled",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Borrador",
  emitting: "Emitiendo",
  emitted: "Emitido",
  failed: "Fallido",
  cancelled: "Cancelado",
};

export const LETTERS = ["A", "B", "C"] as const;

const KIND_VALUES = Object.values(INVOICE_KINDS) as readonly InvoiceKind[];
const LETTER_VALUES = LETTERS as readonly InvoiceLetter[];

// --------------------------------------------------------------------------
// Type guards.
// --------------------------------------------------------------------------

export function isInvoiceKind(value: unknown): value is InvoiceKind {
  return (
    typeof value === "string" &&
    (KIND_VALUES as readonly string[]).includes(value)
  );
}

export function isInvoiceLetter(value: unknown): value is InvoiceLetter {
  return (
    typeof value === "string" &&
    (LETTER_VALUES as readonly string[]).includes(value)
  );
}

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return (
    typeof value === "string" &&
    (INVOICE_STATUSES as readonly string[]).includes(value)
  );
}

// --------------------------------------------------------------------------
// DB rows narrowed to our enums.
// --------------------------------------------------------------------------

type InvoiceDbRow = Database["public"]["Tables"]["invoices"]["Row"];
type ComprobanteItemDbRow =
  Database["public"]["Tables"]["invoice_items"]["Row"];

export type InvoiceRow = Omit<InvoiceDbRow, "kind" | "letter" | "status"> & {
  kind: InvoiceKind;
  letter: InvoiceLetter | null;
  status: InvoiceStatus;
};

export type ComprobanteItemRow = ComprobanteItemDbRow;

export function narrowComprobanteRow(row: InvoiceDbRow): InvoiceRow {
  if (!isInvoiceKind(row.kind)) {
    throw new Error(`Unexpected comprobante kind: ${row.kind}`);
  }
  if (row.letter !== null && !isInvoiceLetter(row.letter)) {
    throw new Error(`Unexpected comprobante letter: ${row.letter}`);
  }
  if (!isInvoiceStatus(row.status)) {
    throw new Error(`Unexpected comprobante status: ${row.status}`);
  }
  return { ...row, kind: row.kind, letter: row.letter, status: row.status };
}

// --------------------------------------------------------------------------
// Item input schema (used by the new-comprobante form).
// --------------------------------------------------------------------------

export const ComprobanteItemInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
  iva_rate_id: z
    .union([
      z.literal(IVA_RATE.ZERO),
      z.literal(IVA_RATE.TEN_FIVE),
      z.literal(IVA_RATE.TWENTY_ONE),
      z.literal(IVA_RATE.TWENTY_SEVEN),
      z.literal(IVA_RATE.FIVE),
      z.literal(IVA_RATE.TWO_FIVE),
    ])
    .nullable(),
});

export type ComprobanteItemInput = z.infer<typeof ComprobanteItemInputSchema>;

// --------------------------------------------------------------------------
// Comprobante input schema (creation).
//
// `letter`, `cbte_tipo_afip` and `iva_condition_receptor` are conditionally
// required when the channel is fiscal. We don't enforce that here because
// the schema doesn't know about the channel — the action layer resolves
// `is_fiscal` and validates accordingly. The DB trigger acts as the final
// gatekeeper.
// --------------------------------------------------------------------------

const conceptoSchema = z.union([
  z.literal(CONCEPTO.PRODUCTOS),
  z.literal(CONCEPTO.SERVICIOS),
  z.literal(CONCEPTO.PRODUCTOS_Y_SERVICIOS),
]);

const docTipoSchema = z.union([
  z.literal(DOC_TIPO.CUIT),
  z.literal(DOC_TIPO.CUIL),
  z.literal(DOC_TIPO.DNI),
  z.literal(DOC_TIPO.CONSUMIDOR_FINAL),
]);

const condicionIvaReceptorSchema = z.union([
  z.literal(CONDICION_IVA_RECEPTOR.RESPONSABLE_INSCRIPTO),
  z.literal(CONDICION_IVA_RECEPTOR.EXENTO),
  z.literal(CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL),
  z.literal(CONDICION_IVA_RECEPTOR.MONOTRIBUTO),
  z.literal(CONDICION_IVA_RECEPTOR.NO_CATEGORIZADO),
  z.literal(CONDICION_IVA_RECEPTOR.PROVEEDOR_EXTERIOR),
  z.literal(CONDICION_IVA_RECEPTOR.CLIENTE_EXTERIOR),
  z.literal(CONDICION_IVA_RECEPTOR.IVA_LIBERADO),
  z.literal(CONDICION_IVA_RECEPTOR.MONOTRIBUTO_SOCIAL),
  z.literal(CONDICION_IVA_RECEPTOR.IVA_NO_ALCANZADO),
  z.literal(CONDICION_IVA_RECEPTOR.MONOTRIBUTO_PROMOVIDO),
]);

const currencySchema = z.union([
  z.literal(MONEDA.PESOS),
  z.literal(MONEDA.DOLARES),
]);

export const CreateComprobanteSchema = z
  .object({
    channel_id: z.string().min(1),
    client_id: z.string().uuid(),
    kind: z.enum(INVOICE_KINDS),
    letter: z.enum(LETTERS).nullable(),
    punto_venta: z.number().int().min(1).max(99999),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha YYYY-MM-DD"),
    fch_serv_desde: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    fch_serv_hasta: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    fch_vto_pago: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    concepto: conceptoSchema,
    doc_tipo: docTipoSchema,
    doc_nro: z.string().trim().min(1).max(20),
    iva_condition_receptor: condicionIvaReceptorSchema.nullable(),
    moneda: currencySchema.default(MONEDA.PESOS),
    cotizacion: z.number().positive().default(1),
    motivo_nc_nd: z.string().trim().max(500).nullable().optional(),
    invoice_origin_id: z.string().uuid().nullable().optional(),
    items: z
      .array(ComprobanteItemInputSchema)
      .min(1, "Agregá al menos un ítem"),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== "factura" && !value.invoice_origin_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Las NC y ND requieren un comprobante origen.",
        path: ["invoice_origin_id"],
      });
    }
  });

export type CreateComprobanteInput = z.infer<typeof CreateComprobanteSchema>;

export const CancelInvoiceSchema = z.object({ id: z.string().uuid() });

/** Statuses an internal invoice can be cancelled from. A fiscal voucher with
 *  CAE is never cancelled: an NC compensates it. */
export const INTERNAL_CANCELLABLE_STATUSES: readonly InvoiceStatus[] = [
  "emitted",
  "failed",
];

// --------------------------------------------------------------------------
// Total computation helpers (server-side reuse).
//
// The reasoning of why we round each line first and then sum: AFIP rejects
// totals that don't reconcile to two decimals. Rounding once at the end can
// leave fractional-cent residuals that fail the consistency check.
// --------------------------------------------------------------------------

export interface ComprobanteTotals {
  imp_neto: number;
  imp_iva: number;
  imp_total: number;
  per_rate: Array<{ id: number; base: number; importe: number }>;
}

type TotalsItem = Pick<
  ComprobanteItemInput,
  "quantity" | "unit_price" | "iva_rate_id"
>;

export interface LineAmounts {
  line_neto: number;
  line_iva: number;
  line_total: number;
}

/** One line's amounts, rounded to cents. Internal channels carry no IVA. */
export function computeLineAmounts(
  item: TotalsItem,
  isFiscal: boolean,
): LineAmounts {
  const lineNeto = round2(item.quantity * item.unit_price);
  const lineIva =
    isFiscal && item.iva_rate_id !== null
      ? round2((lineNeto * ivaRatePercent(item.iva_rate_id)) / 100)
      : 0;
  return {
    line_neto: lineNeto,
    line_iva: lineIva,
    line_total: round2(lineNeto + lineIva),
  };
}

export function computeTotals(
  items: TotalsItem[],
  isFiscal: boolean,
): ComprobanteTotals {
  const buckets = new Map<number, { base: number; importe: number }>();
  let neto = 0;

  for (const item of items) {
    const line = computeLineAmounts(item, isFiscal);
    neto = round2(neto + line.line_neto);

    if (!isFiscal || item.iva_rate_id === null) continue;

    const bucket = buckets.get(item.iva_rate_id) ?? { base: 0, importe: 0 };
    bucket.base = round2(bucket.base + line.line_neto);
    bucket.importe = round2(bucket.importe + line.line_iva);
    buckets.set(item.iva_rate_id, bucket);
  }

  let iva = 0;
  const per_rate: ComprobanteTotals["per_rate"] = [];
  for (const [id, bucket] of buckets) {
    iva = round2(iva + bucket.importe);
    per_rate.push({ id, base: bucket.base, importe: bucket.importe });
  }

  return {
    imp_neto: neto,
    imp_iva: iva,
    imp_total: round2(neto + iva),
    per_rate,
  };
}

/** Join row shape for `channel ( name, division, business_unit_id )` used
 *  by the PDF renders (receipt and payment-order). */
export type ChannelDivisionJoin = {
  channel: {
    name: string;
    division: string;
    business_unit_id: string;
  } | null;
};

/** Embedded `invoice ( letter, kind, punto_venta, numero, fecha )` shape for
 *  allocation rows (receipts + payment-orders detail/PDF). */
export type InvoiceRefJoin = {
  invoice: {
    letter: string | null;
    kind: string;
    punto_venta: number;
    numero: number;
    fecha: string;
  } | null;
};

/** Variant of InvoiceRefJoin that also includes `invoice.channel.is_fiscal`,
 *  needed for the payment-order PDF (distinguishes internal invoices). */
export type InvoiceWithChannelRefJoin = {
  invoice: {
    letter: string | null;
    kind: string;
    punto_venta: number;
    numero: number;
    fecha: string;
    channel: { is_fiscal: boolean } | null;
  } | null;
};

/** Formats the fiscal number of a voucher following the AR convention:
 *  - factura: `A00003-00000001` (letter + POS 5d + dash + number 8d)
 *  - NC/ND: `NC00003-00000001` / `ND00003-00000001` (no letter)
 *  - `numero == null` (draft / AFIP processing): the number segment is
 *    replaced by `opts.whenNullNumero` (default `"—"`; the detail page uses
 *    `"pendiente"`). The prefix + POS is preserved → `"A00003-pendiente"`.
 *  Consolidates 4 dupes that lived in invoices-table, origin-picker,
 *  send-invoice-email and the detail page `app/(dashboard)/invoices/[id]/page.tsx`. */
export function formatInvoiceNumero(
  kind: string,
  letter: string | null,
  puntoVenta: number,
  numero: number | null,
  opts: { whenNullNumero?: string } = {},
): string {
  const pos = String(puntoVenta).padStart(5, "0");
  const num =
    numero == null
      ? (opts.whenNullNumero ?? "—")
      : String(numero).padStart(8, "0");
  if (kind === "factura")
    return letter ? `${letter}${pos}-${num}` : `${pos}-${num}`;
  return `${kind === "nc" ? "NC" : "ND"}${pos}-${num}`;
}
