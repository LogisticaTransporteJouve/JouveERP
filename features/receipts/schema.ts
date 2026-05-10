import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const RECEIPT_STATUSES = ["issued", "canceled"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_CURRENCIES = ["ARS", "USD"] as const;
export type ReceiptCurrency = (typeof RECEIPT_CURRENCIES)[number];

export const RECEIPTS_PATH = "/recibos";

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
});

const AllocationSchema = z.object({
  comprobante_id: z.string().uuid(),
  amount_applied: moneyAmount,
});

const baseReceiptFields = {
  channel_id: z.string().min(1, "Canal requerido."),
  numero: z.number().int().positive("Número debe ser positivo."),
  client_id: z.string().uuid("Cliente requerido."),
  recibo_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  total_amount: moneyAmount,
  currency: z.enum(RECEIPT_CURRENCIES),
  notes: trimmedNullable,
  payment_lines: z.array(PaymentLineSchema).min(1, "Agregá al menos una línea de pago."),
  allocations: z.array(AllocationSchema).optional().default([]),
};

export const ReceiptCreateSchema = z
  .object(baseReceiptFields)
  .superRefine((data, ctx) => {
    const paySum = data.payment_lines.reduce((acc, l) => acc + l.amount, 0);
    if (Math.round(paySum * 100) !== Math.round(data.total_amount * 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payment_lines"],
        message: `La suma de las líneas de pago (${paySum.toFixed(2)}) no coincide con el total (${data.total_amount.toFixed(2)}).`,
      });
    }
    const allocSum = (data.allocations ?? []).reduce(
      (acc, a) => acc + a.amount_applied,
      0,
    );
    if (Math.round(allocSum * 100) > Math.round(data.total_amount * 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allocations"],
        message: `Las imputaciones (${allocSum.toFixed(2)}) superan el total del recibo (${data.total_amount.toFixed(2)}).`,
      });
    }
  });

export const ReceiptUpdateSchema = z
  .object({
    id: z.string().uuid(),
    recibo_date: baseReceiptFields.recibo_date,
    total_amount: baseReceiptFields.total_amount,
    notes: baseReceiptFields.notes,
    payment_lines: baseReceiptFields.payment_lines,
    allocations: baseReceiptFields.allocations,
  })
  .superRefine((data, ctx) => {
    const paySum = data.payment_lines.reduce((acc, l) => acc + l.amount, 0);
    if (Math.round(paySum * 100) !== Math.round(data.total_amount * 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payment_lines"],
        message: `La suma de las líneas de pago (${paySum.toFixed(2)}) no coincide con el total (${data.total_amount.toFixed(2)}).`,
      });
    }
    const allocSum = (data.allocations ?? []).reduce(
      (acc, a) => acc + a.amount_applied,
      0,
    );
    if (Math.round(allocSum * 100) > Math.round(data.total_amount * 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allocations"],
        message: `Las imputaciones (${allocSum.toFixed(2)}) superan el total del recibo (${data.total_amount.toFixed(2)}).`,
      });
    }
  });

export const ReceiptCancelSchema = z.object({
  id: z.string().uuid(),
});

export type ReceiptCreateInput = z.infer<typeof ReceiptCreateSchema>;
export type ReceiptUpdateInput = z.infer<typeof ReceiptUpdateSchema>;
export type ReceiptCancelInput = z.infer<typeof ReceiptCancelSchema>;

export type PaymentLineInput = z.infer<typeof PaymentLineSchema>;
export type AllocationInput = z.infer<typeof AllocationSchema>;

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
