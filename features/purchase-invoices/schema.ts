import { z } from "zod";

export const PURCHASE_INVOICE_KINDS = ["factura", "nc", "nd"] as const;
export type PurchaseInvoiceKind = (typeof PURCHASE_INVOICE_KINDS)[number];

export const PURCHASE_INVOICE_KIND_LABEL: Record<PurchaseInvoiceKind, string> = {
  factura: "Factura",
  nc: "Nota de Crédito",
  nd: "Nota de Débito",
};

export const PURCHASE_INVOICE_LETTERS = ["A", "B", "C"] as const;
export type PurchaseInvoiceLetter = (typeof PURCHASE_INVOICE_LETTERS)[number];

export const PURCHASE_INVOICE_STATUSES = ["received", "cancelled"] as const;
export type PurchaseInvoiceStatus = (typeof PURCHASE_INVOICE_STATUSES)[number];

export const PURCHASE_INVOICE_STATUS_LABEL: Record<PurchaseInvoiceStatus, string> = {
  received: "Recibida",
  cancelled: "Anulada",
};

export const PURCHASE_INVOICES_PATH = "/purchases";

// AFIP rate IDs — mirror of the catalog used in `invoice_items` (sales).
export const PURCHASE_IVA_RATE_IDS = [3, 4, 5, 6, 8, 9] as const;
export type PurchaseIvaRateId = (typeof PURCHASE_IVA_RATE_IDS)[number];

export const PURCHASE_IVA_RATE_LABEL: Record<PurchaseIvaRateId, string> = {
  3: "0%",
  4: "10.5%",
  5: "21%",
  6: "27%",
  8: "5%",
  9: "2.5%",
};

export const PURCHASE_IVA_RATE_PERCENT: Record<PurchaseIvaRateId, number> = {
  3: 0,
  4: 10.5,
  5: 21,
  6: 27,
  8: 5,
  9: 2.5,
};

export function isPurchaseIvaRateId(v: unknown): v is PurchaseIvaRateId {
  return (
    typeof v === "number" &&
    (PURCHASE_IVA_RATE_IDS as readonly number[]).includes(v)
  );
}

const trimmedNullable = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

const amount = z
  .union([z.number(), z.string()])
  .transform((v) => {
    if (typeof v === "number") return v;
    const cleaned = v.replace(/[^0-9.,-]/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  })
  .pipe(z.number().finite());

const positiveAmount = amount.refine((v) => v >= 0, {
  message: "El monto no puede ser negativo.",
});

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).");

const dateNullable = z
  .union([
    z.literal(""),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)."),
  ])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const letterEnum = z.enum(PURCHASE_INVOICE_LETTERS);
const letterNullable = z
  .union([z.literal(""), letterEnum])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

// Items are OPTIONAL. When there are items, the header totals (`imp_neto`,
// `imp_iva`, `imp_total`) are recomputed server-side from the sum of items
// via the RPC `replace_purchase_invoice_items`. When there are no items (typical
// case: the 1313 invoices imported from AFIP in K.2), the header keeps the
// totals that were entered by hand.
export const PurchaseInvoiceItemSchema = z.object({
  description: z.string().trim().min(1, "Descripción requerida.").max(500),
  quantity: amount.refine((v) => v > 0, { message: "Cantidad > 0." }),
  unit_price: positiveAmount,
  iva_rate_id: z
    .union([
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(8),
      z.literal(9),
    ])
    .nullable(),
  line_neto: positiveAmount,
  line_iva: positiveAmount.default(0),
  line_total: positiveAmount,
  sort_order: z.coerce.number().int().default(0),
});

export type PurchaseInvoiceItemInput = z.infer<typeof PurchaseInvoiceItemSchema>;

const itemsArray = z.array(PurchaseInvoiceItemSchema).default([]);

const optionalUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const baseFields = {
  channel_id: z.string().min(1, "Canal requerido."),
  account_id: optionalUuid,
  cost_center_id: optionalUuid,
  supplier_id: z.string().uuid("Proveedor requerido."),
  kind: z.enum(PURCHASE_INVOICE_KINDS),
  letter: letterNullable,
  punto_venta: z.coerce
    .number()
    .int()
    .min(1, "Punto de venta requerido.")
    .max(99999),
  numero: z.coerce.number().int().min(1, "Número requerido."),
  fecha: dateString,
  fch_vto_pago: dateNullable,
  imp_neto: positiveAmount.default(0),
  imp_iva: positiveAmount.default(0),
  imp_trib: positiveAmount.default(0),
  imp_total: positiveAmount,
  moneda: z.string().default("PES"),
  cotizacion: amount.default(1),
  cae_proveedor: trimmedNullable,
  cae_vto_proveedor: dateNullable,
  invoice_origin_id: z
    .union([z.literal(""), z.string().uuid()])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  motivo_nc_nd: trimmedNullable,
  notes: trimmedNullable,
  items: itemsArray,
};

export const PurchaseInvoiceCreateSchema = z
  .object(baseFields)
  .refine(
    (d) => d.kind === "factura" || (d.motivo_nc_nd && d.motivo_nc_nd.length > 0),
    {
      message: "El motivo es requerido para NC/ND.",
      path: ["motivo_nc_nd"],
    },
  );

export const PurchaseInvoiceUpdateSchema = z.object({
  id: z.string().uuid(),
  channel_id: baseFields.channel_id.optional(),
  supplier_id: baseFields.supplier_id.optional(),
  kind: baseFields.kind.optional(),
  letter: baseFields.letter,
  punto_venta: baseFields.punto_venta.optional(),
  numero: baseFields.numero.optional(),
  fecha: baseFields.fecha.optional(),
  fch_vto_pago: baseFields.fch_vto_pago,
  imp_neto: baseFields.imp_neto.optional(),
  imp_iva: baseFields.imp_iva.optional(),
  imp_trib: baseFields.imp_trib.optional(),
  imp_total: baseFields.imp_total.optional(),
  moneda: baseFields.moneda.optional(),
  cotizacion: baseFields.cotizacion.optional(),
  cae_proveedor: baseFields.cae_proveedor,
  cae_vto_proveedor: baseFields.cae_vto_proveedor,
  invoice_origin_id: baseFields.invoice_origin_id,
  motivo_nc_nd: baseFields.motivo_nc_nd,
  notes: baseFields.notes,
  items: itemsArray.optional(),
});

export const PurchaseInvoiceCancelSchema = z.object({
  id: z.string().uuid(),
});

export type PurchaseInvoiceCreateInput = z.infer<typeof PurchaseInvoiceCreateSchema>;
export type PurchaseInvoiceUpdateInput = z.infer<typeof PurchaseInvoiceUpdateSchema>;

export type PurchaseInvoice = {
  id: string;
  channel_id: string;
  supplier_id: string;
  supplier_legal_name: string;
  supplier_cuit: string;
  kind: PurchaseInvoiceKind;
  letter: PurchaseInvoiceLetter | null;
  punto_venta: number;
  numero: number;
  fecha: string;
  fch_vto_pago: string | null;
  imp_neto: number;
  imp_iva: number;
  imp_trib: number;
  imp_total: number;
  moneda: string;
  cotizacion: number;
  cae_proveedor: string | null;
  cae_vto_proveedor: string | null;
  status: PurchaseInvoiceStatus;
  invoice_origin_id: string | null;
  motivo_nc_nd: string | null;
  notes: string | null;
  created_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseInvoiceItem = {
  id: string;
  purchase_invoice_id: string;
  sort_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  iva_rate_id: PurchaseIvaRateId | null;
  line_neto: number;
  line_iva: number;
  line_total: number;
  created_at: string;
};

export function isPurchaseInvoiceKind(v: unknown): v is PurchaseInvoiceKind {
  return typeof v === "string" && (PURCHASE_INVOICE_KINDS as readonly string[]).includes(v);
}

export function isPurchaseInvoiceStatus(v: unknown): v is PurchaseInvoiceStatus {
  return typeof v === "string" && (PURCHASE_INVOICE_STATUSES as readonly string[]).includes(v);
}

/** Embedded `purchase_invoice ( letter, kind, punto_venta, numero, fecha )` join. */
export type PurchaseInvoiceRefJoin = {
  purchase_invoice: {
    letter: PurchaseInvoiceLetter | null;
    kind: PurchaseInvoiceKind;
    punto_venta: number;
    numero: number;
    fecha: string;
  } | null;
};

export function formatInvoiceNumber(p: {
  kind?: PurchaseInvoiceKind;
  letter: PurchaseInvoiceLetter | null;
  punto_venta: number;
  numero: number;
}): string {
  const pv = String(p.punto_venta).padStart(5, "0");
  const nu = String(p.numero).padStart(8, "0");
  if (p.kind === "nc") return `NC${pv}-${nu}`;
  if (p.kind === "nd") return `ND${pv}-${nu}`;
  const letterPart = p.letter ?? "X";
  return `${letterPart}${pv}-${nu}`;
}
