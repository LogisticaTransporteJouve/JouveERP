import { z } from "zod";

export const PURCHASE_INVOICE_KINDS = ["factura", "nc", "nd"] as const;
export type PurchaseInvoiceKind = (typeof PURCHASE_INVOICE_KINDS)[number];

export const PURCHASE_INVOICE_KIND_LABEL: Record<PurchaseInvoiceKind, string> = {
  factura: "Factura",
  nc: "Nota de crédito",
  nd: "Nota de débito",
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

const baseFields = {
  channel_id: z.string().min(1, "Canal requerido."),
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

export function isPurchaseInvoiceKind(v: unknown): v is PurchaseInvoiceKind {
  return typeof v === "string" && (PURCHASE_INVOICE_KINDS as readonly string[]).includes(v);
}

export function isPurchaseInvoiceStatus(v: unknown): v is PurchaseInvoiceStatus {
  return typeof v === "string" && (PURCHASE_INVOICE_STATUSES as readonly string[]).includes(v);
}

export function formatInvoiceNumber(p: {
  letter: PurchaseInvoiceLetter | null;
  punto_venta: number;
  numero: number;
}): string {
  const letterPart = p.letter ?? "X";
  const pv = String(p.punto_venta).padStart(5, "0");
  const nu = String(p.numero).padStart(8, "0");
  return `${letterPart}${pv}-${nu}`;
}
