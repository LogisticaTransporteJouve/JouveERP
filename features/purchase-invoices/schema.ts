import { z } from "zod";
import type { IvaCondition } from "@/features/clients/schema";
import type {
  IvaBreakdownLine,
  TribBreakdown,
} from "@/lib/afip/mis-comprobantes/parse";

export const PURCHASE_INVOICE_KINDS = ["factura", "nc", "nd"] as const;
export type PurchaseInvoiceKind = (typeof PURCHASE_INVOICE_KINDS)[number];

export const PURCHASE_INVOICE_KIND_LABEL: Record<PurchaseInvoiceKind, string> =
  {
    factura: "Factura",
    nc: "Nota de Crédito",
    nd: "Nota de Débito",
  };

/** Otras compras has no facturas: its documents are remitos internos. */
export function purchaseKindLabel(
  kind: PurchaseInvoiceKind,
  isInternal: boolean,
): string {
  if (!isInternal) return PURCHASE_INVOICE_KIND_LABEL[kind];
  if (kind === "factura") return "Remito interno";
  return kind === "nc" ? "Nota de crédito interna" : "Nota de débito interna";
}

export const PURCHASE_INVOICE_LETTERS = ["A", "B", "C"] as const;
export type PurchaseInvoiceLetter = (typeof PURCHASE_INVOICE_LETTERS)[number];

export const PURCHASE_INVOICE_STATUSES = ["received", "cancelled"] as const;
export type PurchaseInvoiceStatus = (typeof PURCHASE_INVOICE_STATUSES)[number];

export const PURCHASE_INVOICE_STATUS_LABEL: Record<
  PurchaseInvoiceStatus,
  string
> = {
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
    const cleaned = v
      .replace(/[^0-9.,-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
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

export type PurchaseInvoiceItemInput = z.infer<
  typeof PurchaseInvoiceItemSchema
>;

const itemsArray = z.array(PurchaseInvoiceItemSchema).default([]);

export const EXEMPT_ITEMS_MESSAGE =
  "Con exento o no gravado en el encabezado, los ítems deben tener alícuota.";

/** An item without a rate next to header exento/no gravado counts them twice
 *  (replace_purchase_invoice_items refuses it too, after the header insert). */
export function itemsDoubleCountExempt(d: {
  imp_no_gravado?: number;
  imp_op_exentas?: number;
  items?: { iva_rate_id: number | null }[];
}): boolean {
  return (
    (d.imp_no_gravado ?? 0) + (d.imp_op_exentas ?? 0) > 0 &&
    (d.items ?? []).some((it) => it.iva_rate_id === null)
  );
}

export const PURCHASE_TOTAL_MISMATCH_MESSAGE =
  "Los importes no suman el total: neto + IVA + otros tributos + no gravado + exento tienen que dar el total del comprobante.";

export type PurchaseTotalParts = {
  imp_neto: number;
  imp_iva: number;
  imp_trib: number;
  imp_no_gravado: number;
  imp_op_exentas: number;
  imp_total: number;
};

export const PURCHASE_TOTAL_PART_FIELDS = [
  "imp_neto",
  "imp_iva",
  "imp_trib",
  "imp_no_gravado",
  "imp_op_exentas",
  "imp_total",
] as const satisfies readonly (keyof PurchaseTotalParts)[];

/** imp_total minus the sum of its parts, rounded to cents; null within a
 *  cent (the journal credits the supplier the parts, the statement the
 *  total). Same formula as guard_purchase_invoice_total, which the database
 *  applies to fiscal purchases only. */
export function purchaseTotalGap(p: PurchaseTotalParts): number | null {
  const gap =
    Math.round(
      (p.imp_total -
        (p.imp_neto +
          p.imp_iva +
          p.imp_trib +
          p.imp_no_gravado +
          p.imp_op_exentas)) *
        100,
    ) / 100;
  return Math.abs(gap) > 0.01 ? gap : null;
}

const optionalUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const baseFields = {
  channel_id: z.string().min(1, "Canal requerido."),
  account_id: optionalUuid,
  cost_center_id: optionalUuid,
  /** "A cargo de empleado"; undefined = leave it as it is. */
  charged_employee_id: optionalUuid,
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
  imp_no_gravado: positiveAmount.default(0),
  imp_op_exentas: positiveAmount.default(0),
  /** imp_trib split; sent with every new purchase. */
  imp_perc_iva: positiveAmount.default(0),
  imp_perc_iibb: positiveAmount.default(0),
  imp_perc_municipales: positiveAmount.default(0),
  imp_impuestos_internos: positiveAmount.default(0),
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
    (d) =>
      d.kind === "factura" || (d.motivo_nc_nd && d.motivo_nc_nd.length > 0),
    {
      message: "El motivo es requerido para NC/ND.",
      path: ["motivo_nc_nd"],
    },
  )
  .refine((d) => d.moneda === "PES" || d.cotizacion > 1, {
    message: "Cargá la cotización del dólar (tiene que ser mayor a 1).",
    path: ["cotizacion"],
  })
  .refine((d) => d.kind === "factura" || Boolean(d.invoice_origin_id), {
    message: "Elegí el comprobante de origen de la nota de crédito o débito.",
    path: ["invoice_origin_id"],
  })
  .refine((d) => !itemsDoubleCountExempt(d), {
    message: EXEMPT_ITEMS_MESSAGE,
    path: ["items"],
  })
  .refine((d) => purchaseTotalGap(d) === null, {
    message: PURCHASE_TOTAL_MISMATCH_MESSAGE,
    path: ["imp_total"],
  });

// An edit sends only what it changes: no field here has a default (Zod applies
// an inner default under .optional(), which would overwrite the stored value),
// and the action checks the total against the amounts merged with the row.
export const PurchaseInvoiceUpdateSchema = z
  .object({
    id: z.string().uuid(),
    channel_id: baseFields.channel_id.optional(),
    account_id: baseFields.account_id,
    cost_center_id: baseFields.cost_center_id,
    charged_employee_id: baseFields.charged_employee_id,
    supplier_id: baseFields.supplier_id.optional(),
    kind: baseFields.kind.optional(),
    letter: baseFields.letter,
    punto_venta: baseFields.punto_venta.optional(),
    numero: baseFields.numero.optional(),
    fecha: baseFields.fecha.optional(),
    fch_vto_pago: baseFields.fch_vto_pago,
    imp_neto: positiveAmount.optional(),
    imp_iva: positiveAmount.optional(),
    imp_trib: positiveAmount.optional(),
    imp_no_gravado: positiveAmount.optional(),
    imp_op_exentas: positiveAmount.optional(),
    imp_perc_iva: positiveAmount.optional(),
    imp_perc_iibb: positiveAmount.optional(),
    imp_perc_municipales: positiveAmount.optional(),
    imp_impuestos_internos: positiveAmount.optional(),
    imp_total: baseFields.imp_total.optional(),
    moneda: z.string().optional(),
    cotizacion: amount.optional(),
    cae_proveedor: baseFields.cae_proveedor,
    cae_vto_proveedor: baseFields.cae_vto_proveedor,
    invoice_origin_id: baseFields.invoice_origin_id,
    motivo_nc_nd: baseFields.motivo_nc_nd,
    notes: baseFields.notes,
    items: z.array(PurchaseInvoiceItemSchema).optional(),
  })
  .refine(
    (d) =>
      d.moneda === undefined ||
      d.moneda === "PES" ||
      d.cotizacion === undefined ||
      d.cotizacion > 1,
    {
      message: "Cargá la cotización del dólar (tiene que ser mayor a 1).",
      path: ["cotizacion"],
    },
  )
  .refine((d) => !itemsDoubleCountExempt(d), {
    message: EXEMPT_ITEMS_MESSAGE,
    path: ["items"],
  });

export const PurchaseInvoiceCancelSchema = z.object({
  id: z.string().uuid(),
});

export type PurchaseInvoiceCreateInput = z.infer<
  typeof PurchaseInvoiceCreateSchema
>;
export type PurchaseInvoiceUpdateInput = z.infer<
  typeof PurchaseInvoiceUpdateSchema
>;

export type PurchaseInvoice = {
  id: string;
  channel_id: string;
  /** Expense account the neto posts to; null posts to the 'compras' role. */
  account_id: string | null;
  cost_center_id: string | null;
  /** "A cargo de empleado". Only the detail read carries it; a listed row
   *  leaves it undefined. */
  charged_employee_id?: string | null;
  supplier_id: string;
  supplier_legal_name: string;
  supplier_cuit: string | null;
  kind: PurchaseInvoiceKind;
  letter: PurchaseInvoiceLetter | null;
  punto_venta: number;
  numero: number;
  fecha: string;
  fch_vto_pago: string | null;
  imp_neto: number;
  imp_iva: number;
  imp_trib: number;
  /** Exento, no gravado and the imp_trib split. Only the detail read carries
   *  them; a listed row leaves them undefined. */
  amount_breakdown?: PurchaseAmountBreakdown;
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

export type PurchaseAmountBreakdown = {
  imp_no_gravado: number;
  imp_op_exentas: number;
  imp_perc_iva: number;
  imp_perc_iibb: number;
  imp_perc_municipales: number;
  imp_impuestos_internos: number;
};

export const PURCHASE_TRIBUTE_FIELDS = [
  "imp_perc_iva",
  "imp_perc_iibb",
  "imp_perc_municipales",
  "imp_impuestos_internos",
] as const satisfies readonly (keyof PurchaseAmountBreakdown)[];

export const PURCHASE_TRIBUTE_LABEL: Record<
  (typeof PURCHASE_TRIBUTE_FIELDS)[number],
  string
> = {
  imp_perc_iva: "Percepción IVA",
  imp_perc_iibb: "Percepción IIBB",
  imp_perc_municipales: "Municipales",
  imp_impuestos_internos: "Impuestos internos",
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
  return (
    typeof v === "string" &&
    (PURCHASE_INVOICE_KINDS as readonly string[]).includes(v)
  );
}

export function isPurchaseInvoiceLetter(
  v: unknown,
): v is PurchaseInvoiceLetter {
  return (
    typeof v === "string" &&
    (PURCHASE_INVOICE_LETTERS as readonly string[]).includes(v)
  );
}

export function isPurchaseInvoiceStatus(
  v: unknown,
): v is PurchaseInvoiceStatus {
  return (
    typeof v === "string" &&
    (PURCHASE_INVOICE_STATUSES as readonly string[]).includes(v)
  );
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
  kind?: PurchaseInvoiceKind | string;
  letter: PurchaseInvoiceLetter | string | null;
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

// ---------------------------------------------------------------------------
// ARCA received vouchers (tray, arca_received_vouchers)
// ---------------------------------------------------------------------------

export const RECEIVED_VOUCHER_STATUSES = [
  "pending_review",
  "confirmed",
  "discarded",
  "unsupported",
] as const;
export type ReceivedVoucherStatus = (typeof RECEIVED_VOUCHER_STATUSES)[number];

export function isReceivedVoucherStatus(
  v: unknown,
): v is ReceivedVoucherStatus {
  return (
    typeof v === "string" &&
    (RECEIVED_VOUCHER_STATUSES as readonly string[]).includes(v)
  );
}

export const RECEIVED_VOUCHER_TAB_LABEL: Record<ReceivedVoucherStatus, string> =
  {
    pending_review: "Pendientes",
    confirmed: "Cargadas",
    discarded: "Descartadas",
    unsupported: "No soportados",
  };

/** A tray row as the page shows it. */
export type ReceivedVoucher = {
  id: string;
  issuer_cuit: string;
  issuer_name: string;
  cbte_tipo: number;
  kind: PurchaseInvoiceKind | null;
  letter: PurchaseInvoiceLetter | null;
  punto_venta: number;
  numero: number;
  fecha: string;
  cae: string | null;
  moneda: "PES" | "DOL";
  cotizacion: number | null;
  imp_neto_gravado: number;
  imp_no_gravado: number;
  imp_op_exentas: number;
  imp_iva: number;
  imp_trib: number;
  imp_total: number;
  /** Per-tribute amounts, when the export carried them. */
  trib_breakdown: TribBreakdown;
  iva_breakdown: IvaBreakdownLine[];
  status: ReceivedVoucherStatus;
  discard_reason: string | null;
  /** The purchase it is linked to: its status and whether its channel is
   *  fiscal (an internal one cannot happen, but the page says so). */
  purchase: {
    id: string;
    status: PurchaseInvoiceStatus;
    is_fiscal: boolean;
  } | null;
  /** The fiscal supplier with the issuer's CUIT, if loaded. */
  supplier: {
    id: string;
    legal_name: string;
    display_name: string | null;
    cuit: string;
    iva_condition: IvaCondition;
  } | null;
};

export const ReceivedVoucherListSchema = z.object({
  status: z.enum(RECEIVED_VOUCHER_STATUSES),
  cursor: z
    .object({ fecha: z.string().date(), id: z.string().uuid() })
    .nullable()
    .default(null),
});

export const ReceivedVoucherIdSchema = z.object({
  voucherId: z.string().uuid(),
});

export const ReceivedVoucherDiscardSchema = z.object({
  voucherId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .max(200, "Hasta 200 caracteres.")
    .optional()
    .transform((v) => (v ? v : null)),
});
