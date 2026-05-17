import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const RECEIPT_STATUSES = ["issued", "canceled"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_CURRENCIES = ["ARS", "USD"] as const;
export type ReceiptCurrency = (typeof RECEIPT_CURRENCIES)[number];

export const RECEIPTS_PATH = "/receipts";

const trimmedNullable = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

const moneyAmount = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const cleaned = value.trim().replace(/\./g, "").replace(",", ".");
      if (cleaned.length === 0) return undefined;
      const parsed = Number.parseFloat(cleaned);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  },
  z
    .number()
    .finite("Importe inválido.")
    .gt(0, "El importe debe ser mayor a cero.")
    .max(1_000_000_000_000),
);

// Optional check metadata: only relevant when payment_line.account_id
// points to an account of type cheques/echeq. Validated at the DB level —
// the RPC ignores it for other account types.
const PaymentLineCheckSchema = z.object({
  check_number: z.string().trim().max(60).optional(),
  bank_name: z.string().trim().max(120).optional(),
  drawer_name: z.string().trim().max(120).optional(),
  drawer_cuit: z
    .string()
    .trim()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => value.length === 0 || /^[0-9]{11}$/.test(value), {
      message: "CUIT debe tener 11 dígitos.",
    })
    .optional(),
  issue_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de emisión inválida.")
    .optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de cobro inválida."),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
});

const PaymentLineSchema = z.object({
  account_id: z.string().uuid("Cuenta requerida."),
  amount: moneyAmount,
  reference: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  check: PaymentLineCheckSchema.optional(),
});

export type PaymentLineCheck = z.infer<typeof PaymentLineCheckSchema>;

const AllocationSchema = z.object({
  invoice_id: z.string().uuid(),
  amount_applied: moneyAmount,
});

export const RETENTION_KINDS = ["retencion", "percepcion"] as const;
export type RetentionKind = (typeof RETENTION_KINDS)[number];

export const RETENTION_KIND_LABEL: Record<RetentionKind, string> = {
  retencion: "Retención",
  percepcion: "Percepción",
};

export const RETENTION_TAX_TYPES = [
  "ganancias",
  "iva",
  "iibb",
  "suss",
  "otros",
] as const;
export type RetentionTaxType = (typeof RETENTION_TAX_TYPES)[number];

export const RETENTION_TAX_TYPE_LABEL: Record<RetentionTaxType, string> = {
  ganancias: "Ganancias",
  iva: "IVA",
  iibb: "IIBB",
  suss: "SUSS",
  otros: "Otros",
};

const RetentionSchema = z.object({
  kind: z.enum(RETENTION_KINDS),
  tax_type: z.enum(RETENTION_TAX_TYPES),
  jurisdiction: z
    .string()
    .trim()
    .max(50)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  certificate_number: z
    .string()
    .trim()
    .min(1, "Nro. de certificado requerido.")
    .max(60),
  certificate_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de certificado inválida."),
  amount: moneyAmount,
  notes: trimmedNullable,
});

const baseReceiptFields = {
  channel_id: z.string().min(1, "Canal requerido."),
  numero: z.number().int().positive("Número debe ser positivo."),
  client_id: z.string().uuid("Cliente requerido."),
  receipt_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  total_amount: moneyAmount,
  currency: z.enum(RECEIPT_CURRENCIES),
  notes: trimmedNullable,
  payment_lines: z
    .array(PaymentLineSchema)
    .min(1, "Agregá al menos una línea de pago."),
  allocations: z.array(AllocationSchema).optional().default([]),
  retentions: z.array(RetentionSchema).optional().default([]),
};

function validateSums(
  data: {
    total_amount: number;
    payment_lines: { amount: number }[];
    allocations?: { amount_applied: number }[];
    retentions?: { amount: number }[];
  },
  ctx: z.RefinementCtx,
) {
  const paySum = data.payment_lines.reduce((acc, l) => acc + l.amount, 0);
  const retentionSum = (data.retentions ?? []).reduce(
    (acc, r) => acc + r.amount,
    0,
  );
  const cents = (n: number) => Math.round(n * 100);
  if (cents(paySum + retentionSum) !== cents(data.total_amount)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payment_lines"],
      message: `Líneas de pago (${paySum.toFixed(2)}) + retenciones (${retentionSum.toFixed(2)}) = ${(paySum + retentionSum).toFixed(2)} no coincide con el total (${data.total_amount.toFixed(2)}).`,
    });
  }
  const allocSum = (data.allocations ?? []).reduce(
    (acc, a) => acc + a.amount_applied,
    0,
  );
  if (cents(allocSum) > cents(data.total_amount)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["allocations"],
      message: `Las imputaciones (${allocSum.toFixed(2)}) superan el total del recibo (${data.total_amount.toFixed(2)}).`,
    });
  }
}

export const ReceiptCreateSchema = z
  .object(baseReceiptFields)
  .superRefine(validateSums);

export const ReceiptUpdateSchema = z
  .object({
    id: z.string().uuid(),
    receipt_date: baseReceiptFields.receipt_date,
    total_amount: baseReceiptFields.total_amount,
    notes: baseReceiptFields.notes,
    payment_lines: baseReceiptFields.payment_lines,
    allocations: baseReceiptFields.allocations,
    retentions: baseReceiptFields.retentions,
  })
  .superRefine(validateSums);

export const ReceiptCancelSchema = z.object({
  id: z.string().uuid(),
});

export type ReceiptCreateInput = z.infer<typeof ReceiptCreateSchema>;
export type ReceiptUpdateInput = z.infer<typeof ReceiptUpdateSchema>;
export type ReceiptCancelInput = z.infer<typeof ReceiptCancelSchema>;

export type PaymentLineInput = z.infer<typeof PaymentLineSchema>;
export type AllocationInput = z.infer<typeof AllocationSchema>;
export type RetentionInput = z.infer<typeof RetentionSchema>;

export function isReceiptStatus(value: unknown): value is ReceiptStatus {
  return (
    typeof value === "string" &&
    (RECEIPT_STATUSES as readonly string[]).includes(value)
  );
}

export function isReceiptCurrency(value: unknown): value is ReceiptCurrency {
  return (
    typeof value === "string" &&
    (RECEIPT_CURRENCIES as readonly string[]).includes(value)
  );
}

type ReceiptRow = Database["public"]["Tables"]["receipts"]["Row"];
export type Receipt = Omit<ReceiptRow, "status" | "currency"> & {
  status: ReceiptStatus;
  currency: ReceiptCurrency;
};

export type ReceiptPaymentLine =
  Database["public"]["Tables"]["receipt_payment_lines"]["Row"];

export type ReceiptAllocation =
  Database["public"]["Tables"]["receipt_allocations"]["Row"];

type ReceiptRetentionRow =
  Database["public"]["Tables"]["receipt_retentions"]["Row"];
export type ReceiptRetention = Omit<
  ReceiptRetentionRow,
  "kind" | "tax_type"
> & {
  kind: RetentionKind;
  tax_type: RetentionTaxType;
};

export function isRetentionKind(value: unknown): value is RetentionKind {
  return (
    typeof value === "string" &&
    (RETENTION_KINDS as readonly string[]).includes(value)
  );
}

export function isRetentionTaxType(value: unknown): value is RetentionTaxType {
  return (
    typeof value === "string" &&
    (RETENTION_TAX_TYPES as readonly string[]).includes(value)
  );
}

/** Join row shape for `receipts ( status )` selected from another table. */
export type ReceiptStatusJoin = { receipts: { status: string } | null };

/** Forma del row al traer `receipt_id, receipts!inner ( status )` para
 *  calcular saldos imputados (combina ReceiptStatusJoin + FK del padre). */
export type ReceiptAllocationStatusRow = {
  receipt_id: string;
  receipts: { status: string } | null;
};

/**
 * Format `R{POS:4}-{numero:8}` — e.g. `R0003-00000001`. Used everywhere a
 * recibo number is rendered (table, dialog title, PDF when added in F.7).
 */
export function formatReceiptNumber(
  puntoVenta: number,
  numero: number,
): string {
  const pos = String(puntoVenta).padStart(4, "0");
  const num = String(numero).padStart(8, "0");
  return `R${pos}-${num}`;
}
