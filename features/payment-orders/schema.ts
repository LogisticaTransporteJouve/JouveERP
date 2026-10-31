import { z } from "zod";
import { moneyAmountPreprocess } from "@/lib/validation/common";

import type { Database } from "@/lib/db/database.types";

export const PAYMENT_ORDER_STATUSES = ["issued", "canceled"] as const;
export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

export const PAYMENT_ORDER_CURRENCIES = ["ARS", "USD"] as const;
export type PaymentOrderCurrency = (typeof PAYMENT_ORDER_CURRENCIES)[number];

const trimmedNullable = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

const moneyAmount = z.preprocess(
  moneyAmountPreprocess,
  z
    .number()
    .finite("Importe inválido.")
    .gt(0, "El importe debe ser mayor a cero.")
    .max(1_000_000_000_000),
);

export const ISSUED_CHECK_KINDS = ["fisico", "echeq"] as const;
export type IssuedCheckKind = (typeof ISSUED_CHECK_KINDS)[number];

const IssuedCheckPayloadSchema = z.object({
  kind: z.enum(ISSUED_CHECK_KINDS),
  check_number: z.string().trim().min(1, "Nº cheque requerido.").max(40),
  bank_name: z.string().trim().min(1, "Banco requerido.").max(120),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de vto. inválida."),
  issue_date: z
    .union([
      z.literal(""),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de emisión inválida."),
    ])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  beneficiary_name: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  beneficiary_cuit: z
    .string()
    .trim()
    .max(20)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  notes: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
});

const PaymentLineAccountSchema = z.object({
  line_kind: z.literal("account"),
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

const PaymentLineEndorseSchema = z.object({
  line_kind: z.literal("endorse_check"),
  endorsed_check_id: z.string().uuid("Cheque requerido."),
  amount: moneyAmount,
  reference: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
});

const PaymentLineIssueSchema = z.object({
  line_kind: z.literal("issue_check"),
  account_id: z.string().uuid("Chequera (cuenta bancaria) requerida."),
  amount: moneyAmount,
  reference: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  issued_check: IssuedCheckPayloadSchema,
});

const PaymentLineSchema = z.discriminatedUnion("line_kind", [
  PaymentLineAccountSchema,
  PaymentLineEndorseSchema,
  PaymentLineIssueSchema,
]);

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
export type PaymentLineAccountInput = z.infer<typeof PaymentLineAccountSchema>;
export type PaymentLineEndorseInput = z.infer<typeof PaymentLineEndorseSchema>;
export type PaymentLineIssueInput = z.infer<typeof PaymentLineIssueSchema>;
export type IssuedCheckPayload = z.infer<typeof IssuedCheckPayloadSchema>;
export type AllocationInput = z.infer<typeof AllocationSchema>;

export function isPaymentOrderStatus(v: unknown): v is PaymentOrderStatus {
  return (
    typeof v === "string" &&
    (PAYMENT_ORDER_STATUSES as readonly string[]).includes(v)
  );
}

export function isPaymentOrderCurrency(v: unknown): v is PaymentOrderCurrency {
  return (
    typeof v === "string" &&
    (PAYMENT_ORDER_CURRENCIES as readonly string[]).includes(v)
  );
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

/** Join row shape for `payment_orders ( status )` selected from another table. */
export type PaymentOrderStatusJoin = {
  payment_orders: { status: string } | null;
};

/** Row shape when selecting `payment_order_id, payment_orders!inner ( status )`
 *  to compute allocated balances (combines StatusJoin + the parent FK). */
export type PaymentOrderAllocationStatusRow = {
  payment_order_id: string;
  payment_orders: { status: string } | null;
};

/** Embedded `endorsed_check ( id, kind, … )` shape inside a payment line row. */
export type EndorsedCheckJoin = {
  endorsed_check: {
    id: string;
    kind: "fisico" | "echeq";
    check_number: string;
    bank_name: string;
    due_date: string;
    drawer_name: string;
  } | null;
};

/** Embedded `issued_check ( id, kind, … )` shape inside a payment line row. */
export type IssuedCheckJoin = {
  issued_check: {
    id: string;
    kind: "fisico" | "echeq";
    check_number: string;
    bank_name: string;
    due_date: string;
    status: string;
  } | null;
};
