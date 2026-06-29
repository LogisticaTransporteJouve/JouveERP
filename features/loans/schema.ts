import { z } from "zod";

export const LOAN_KINDS = ["prestamo", "leasing"] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];
export const LOAN_KIND_LABEL: Record<LoanKind, string> = {
  prestamo: "Préstamo",
  leasing: "Leasing",
};

export const LOAN_STATUSES = ["active", "paid", "cancelled"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  active: "Activo",
  paid: "Cancelado",
  cancelled: "Anulado",
};

export const INSTALLMENT_STATUSES = ["pendiente", "pagada"] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];
export const INSTALLMENT_STATUS_LABEL: Record<InstallmentStatus, string> = {
  pendiente: "Pendiente",
  pagada: "Pagada",
};

export interface LoanInstallment {
  id: string;
  loan_id: string;
  number: number;
  due_date: string;
  amount: number;
  status: InstallmentStatus;
  paid_date: string | null;
  paid_amount: number | null;
  transaction_id: string | null;
  notes: string | null;
}

export interface LoanListItem {
  id: string;
  kind: LoanKind;
  description: string;
  lender: string | null;
  principal: number;
  currency: string;
  channel_id: string;
  channel_name: string | null;
  installments_count: number;
  first_due_date: string;
  status: LoanStatus;
  notes: string | null;
  created_at: string;
  // computed summary
  paid_total: number;
  pending_total: number;
  pending_count: number;
  next_due_date: string | null;
}

export interface LoanDetail extends LoanListItem {
  installments: LoanInstallment[];
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const CreateLoanSchema = z.object({
  kind: z.enum(LOAN_KINDS).default("prestamo"),
  description: z.string().trim().min(1, "Descripción requerida.").max(200),
  lender: optionalText(200),
  principal: z.coerce.number().positive("El capital debe ser mayor a 0."),
  currency: z.enum(["ARS", "USD"]).default("ARS"),
  channel_id: z.string().min(1, "Canal requerido."),
  installments_count: z.coerce
    .number()
    .int("Cantidad de cuotas inválida.")
    .min(1, "Mínimo 1 cuota.")
    .max(600, "Máximo 600 cuotas."),
  first_due_date: dateStr,
  notes: optionalText(2000),
});
export type CreateLoanInput = z.infer<typeof CreateLoanSchema>;

export const UpdateInstallmentSchema = z.object({
  id: z.string().uuid(),
  amount: z.coerce.number().min(0, "No puede ser negativo.").optional(),
  due_date: dateStr.optional(),
  notes: optionalText(500),
});

export const PayInstallmentSchema = z.object({
  id: z.string().uuid(),
  paid_date: dateStr,
  account_id: z.string().uuid("Cuenta requerida."),
  amount: z.coerce.number().positive("El monto debe ser mayor a 0."),
});

export const CancelLoanSchema = z.object({ id: z.string().uuid() });

export function isLoanKind(v: unknown): v is LoanKind {
  return typeof v === "string" && (LOAN_KINDS as readonly string[]).includes(v);
}
export function isLoanStatus(v: unknown): v is LoanStatus {
  return (
    typeof v === "string" && (LOAN_STATUSES as readonly string[]).includes(v)
  );
}
export function isInstallmentStatus(v: unknown): v is InstallmentStatus {
  return (
    typeof v === "string" &&
    (INSTALLMENT_STATUSES as readonly string[]).includes(v)
  );
}
