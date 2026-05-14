import { z } from "zod";

export const ISSUED_CHECK_KINDS = ["fisico", "echeq"] as const;
export type IssuedCheckKind = (typeof ISSUED_CHECK_KINDS)[number];

export const ISSUED_CHECK_KIND_LABEL: Record<IssuedCheckKind, string> = {
  fisico: "Físico",
  echeq: "e-Cheq",
};

export const ISSUED_CHECK_STATUSES = [
  "emitted",
  "cashed",
  "rejected",
  "cancelled",
] as const;
export type IssuedCheckStatus = (typeof ISSUED_CHECK_STATUSES)[number];

export const ISSUED_CHECK_STATUS_LABEL: Record<IssuedCheckStatus, string> = {
  emitted: "Emitido",
  cashed: "Cobrado",
  rejected: "Rechazado",
  cancelled: "Anulado",
};

export const ISSUED_CHECK_CURRENCIES = ["ARS", "USD"] as const;
export type IssuedCheckCurrency = (typeof ISSUED_CHECK_CURRENCIES)[number];

const trimmedNullable = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

const positiveAmount = z
  .union([z.number(), z.string()])
  .transform((v) => {
    if (typeof v === "number") return v;
    const cleaned = v.replace(/[^0-9.,-]/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  })
  .pipe(z.number().finite().gt(0, "El monto debe ser mayor a cero."));

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

const baseFields = {
  kind: z.enum(ISSUED_CHECK_KINDS),
  check_number: z.string().trim().min(1, "Número requerido.").max(60),
  bank_name: z.string().trim().min(1, "Banco requerido.").max(120),
  beneficiary_name: trimmedNullable,
  beneficiary_cuit: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^0-9]/g, ""))
    .refine((v) => v.length === 0 || /^[0-9]{11}$/.test(v), {
      message: "CUIT debe tener 11 dígitos.",
    })
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  issue_date: dateString,
  due_date: dateString,
  amount: positiveAmount,
  currency: z.enum(ISSUED_CHECK_CURRENCIES),
  bank_account_id: z.string().uuid("Cuenta bancaria requerida."),
  payment_order_id: z
    .union([z.literal(""), z.string().uuid()])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  supplier_id: z
    .union([z.literal(""), z.string().uuid()])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  notes: trimmedNullable,
};

export const IssuedCheckCreateSchema = z.object(baseFields);

export const IssuedCheckUpdateSchema = z.object({
  id: z.string().uuid(),
  kind: baseFields.kind.optional(),
  check_number: baseFields.check_number.optional(),
  bank_name: baseFields.bank_name.optional(),
  beneficiary_name: baseFields.beneficiary_name,
  beneficiary_cuit: baseFields.beneficiary_cuit,
  issue_date: baseFields.issue_date.optional(),
  due_date: baseFields.due_date.optional(),
  amount: baseFields.amount.optional(),
  currency: baseFields.currency.optional(),
  bank_account_id: baseFields.bank_account_id.optional(),
  payment_order_id: baseFields.payment_order_id,
  supplier_id: baseFields.supplier_id,
  notes: baseFields.notes,
});

export const IssuedCheckTransitionSchema = z.object({
  id: z.string().uuid(),
  to_status: z.enum(["cashed", "rejected", "cancelled"]),
  event_date: dateString.optional(),
});

export type IssuedCheckCreateInput = z.infer<typeof IssuedCheckCreateSchema>;
export type IssuedCheckUpdateInput = z.infer<typeof IssuedCheckUpdateSchema>;
export type IssuedCheckTransitionInput = z.infer<typeof IssuedCheckTransitionSchema>;

export type IssuedCheck = {
  id: string;
  kind: IssuedCheckKind;
  check_number: string;
  bank_name: string;
  beneficiary_name: string | null;
  beneficiary_cuit: string | null;
  issue_date: string;
  due_date: string;
  amount: number;
  currency: IssuedCheckCurrency;
  bank_account_id: string;
  payment_order_id: string | null;
  supplier_id: string | null;
  supplier_legal_name?: string | null;
  bank_account_name?: string | null;
  status: IssuedCheckStatus;
  cashed_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function isIssuedCheckKind(v: unknown): v is IssuedCheckKind {
  return typeof v === "string" && (ISSUED_CHECK_KINDS as readonly string[]).includes(v);
}

export function isIssuedCheckStatus(v: unknown): v is IssuedCheckStatus {
  return typeof v === "string" && (ISSUED_CHECK_STATUSES as readonly string[]).includes(v);
}

export function isIssuedCheckCurrency(v: unknown): v is IssuedCheckCurrency {
  return typeof v === "string" && (ISSUED_CHECK_CURRENCIES as readonly string[]).includes(v);
}
