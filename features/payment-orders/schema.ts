import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const PAYMENT_ORDER_STATUSES = ["issued", "canceled"] as const;
export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

export const PAYMENT_ORDER_CURRENCIES = ["ARS", "USD"] as const;
export type PaymentOrderCurrency = (typeof PAYMENT_ORDER_CURRENCIES)[number];

export const PAYMENT_ORDERS_PATH = "/payment-orders";

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
  purchase_invoice_id: z.string().uuid(),
  amount_applied: moneyAmount,
});

const baseFields = {
  channel_id: z.string().min(1, "Canal requerido."),
  numero: z.number().int().positive("Número debe ser positivo."),
  supplier_id: z.string().uuid("Proveedor requerido."),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  total_amount: moneyAmount,
  currency: z.enum(PAYMENT_ORDER_CURRENCIES),
  notes: trimmedNullable,
  payment_lines: z
    .array(PaymentLineSchema)
    .min(1, "Agregá al menos una línea de pago."),
  allocations: z.array(AllocationSchema).optional().default([]),
};

function validateSums(
  data: {
    total_amount: number;
    payment_lines: { amount: number }[];
    allocations?: { amount_applied: number }[];
  },
  ctx: z.RefinementCtx,
) {
  const paySum = data.payment_lines.reduce((acc, l) => acc + l.amount, 0);
  const cents = (n: number) => Math.round(n * 100);
  if (cents(paySum) !== cents(data.total_amount)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payment_lines"],
      message: `La suma de pagos (${paySum.toFixed(2)}) no coincide con el total (${data.total_amount.toFixed(2)}).`,
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
      message: `Las imputaciones (${allocSum.toFixed(2)}) superan el total de la OP (${data.total_amount.toFixed(2)}).`,
    });
  }
}

export const PaymentOrderCreateSchema = z
  .object(baseFields)
  .superRefine(validateSums);

export const PaymentOrderUpdateSchema = z
  .object({
    id: z.string().uuid(),
    payment_date: baseFields.payment_date,
    total_amount: baseFields.total_amount,
    notes: baseFields.notes,
    payment_lines: baseFields.payment_lines,
    allocations: baseFields.allocations,
  })
  .superRefine(validateSums);

export const PaymentOrderCancelSchema = z.object({
  id: z.string().uuid(),
});

export type PaymentOrderCreateInput = z.infer<typeof PaymentOrderCreateSchema>;
export type PaymentOrderUpdateInput = z.infer<typeof PaymentOrderUpdateSchema>;
export type PaymentLineInput = z.infer<typeof PaymentLineSchema>;
export type AllocationInput = z.infer<typeof AllocationSchema>;

export function isPaymentOrderStatus(v: unknown): v is PaymentOrderStatus {
  return typeof v === "string" && (PAYMENT_ORDER_STATUSES as readonly string[]).includes(v);
}

export function isPaymentOrderCurrency(v: unknown): v is PaymentOrderCurrency {
  return typeof v === "string" && (PAYMENT_ORDER_CURRENCIES as readonly string[]).includes(v);
}

type PaymentOrderRow = Database["public"]["Tables"]["payment_orders"]["Row"];
export type PaymentOrder = Omit<PaymentOrderRow, "status" | "currency"> & {
  status: PaymentOrderStatus;
  currency: PaymentOrderCurrency;
};

export type PaymentOrderPaymentLine =
  Database["public"]["Tables"]["payment_order_payment_lines"]["Row"];

export type PaymentOrderAllocation =
  Database["public"]["Tables"]["payment_order_allocations"]["Row"];

export function formatPaymentOrderNumber(
  puntoVenta: number,
  numero: number,
): string {
  const pos = String(puntoVenta).padStart(4, "0");
  const num = String(numero).padStart(8, "0");
  return `OP${pos}-${num}`;
}
