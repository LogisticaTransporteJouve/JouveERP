import { z } from "zod";

import { LEASING_CHARGE_CONCEPTS } from "@/lib/loans/leasing-statement";

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
  /** Optional split of the cuota; null = no split (posted whole as an expense). */
  split: InstallmentSplit | null;
  /** Paid before the loan was loaded: no movement in Caja. */
  paid_outside: boolean;
  /** What «otros» is made of (seguro, patentes, mora…); empty = no detail. */
  charges: LoanInstallmentCharge[];
}

export type LoanChargeConcept = (typeof LEASING_CHARGE_CONCEPTS)[number];

export const LOAN_CHARGE_CONCEPT_LABEL: Record<LoanChargeConcept, string> = {
  seguro: "Seguro",
  patentes: "Patentes",
  mora: "Mora",
  valor_residual: "Valor residual",
  otro: "Otro cargo",
};

export interface LoanInstallmentCharge {
  id: string;
  concept: LoanChargeConcept;
  description: string | null;
  /** Without IVA. */
  amount: number;
  iva_amount: number;
}

export function isLoanChargeConcept(v: unknown): v is LoanChargeConcept {
  return (
    typeof v === "string" &&
    (LEASING_CHARGE_CONCEPTS as readonly string[]).includes(v)
  );
}

export interface InstallmentSplit {
  capital: number;
  interest: number;
  iva: number;
  perception: number;
  other: number;
}

export const INSTALLMENT_SPLIT_KEYS = [
  "capital",
  "interest",
  "iva",
  "perception",
  "other",
] as const;

export const INSTALLMENT_SPLIT_LABEL: Record<keyof InstallmentSplit, string> = {
  capital: "Capital",
  interest: "Interés",
  iva: "IVA",
  perception: "Percepción",
  other: "Otros cargos (sellos, punitorios)",
};

/** Σ of the split, rounded to cents: it must equal the cuota's amount. */
export function splitTotal(split: InstallmentSplit): number {
  return (
    Math.round(
      (split.capital +
        split.interest +
        split.iva +
        split.perception +
        split.other) *
        100,
    ) / 100
  );
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
  /** Income of the disbursement in treasury; null = not recorded. */
  disbursement_transaction_id: string | null;
  /** The bank's loan number. */
  loan_number: string | null;
  /** The account the cuotas are debited from. */
  account_id: string | null;
  account_name: string | null;
  start_date: string | null;
  original_amount: number | null;
  tna: number | null;
  tea: number | null;
  cft: number | null;
  // computed summary
  /** Paid through Caja (a cuota paid before the loan was loaded is not). */
  paid_total: number;
  /** Every paid cuota, also those paid before. */
  paid_count: number;
  /** Interest of the paid cuotas (with a split). */
  interest_paid: number;
  next_due_amount: number | null;
  /** Capital still owed: principal − capital of the paid cuotas (an unsplit
   *  cuota counts whole as capital, as the management P&L reads it). */
  capital_outstanding: number;
  pending_total: number;
  pending_count: number;
  next_due_date: string | null;
}

/** The cancel the database accepts (guard_loan): an active loan with no
 *  disbursement recorded and nothing paid, i.e. one entered by mistake. */
export function canCancelLoan(
  loan: Pick<
    LoanListItem,
    "status" | "disbursement_transaction_id" | "paid_total"
  >,
): boolean {
  return (
    loan.status === "active" &&
    loan.disbursement_transaction_id === null &&
    loan.paid_total === 0
  );
}

/** A bank payment receipt of the loan, loaded from its PDF. */
export interface LoanBankPayment {
  id: string;
  receipt_number: string;
  paid_date: string;
  installment_number: number;
  total: number;
  capital: number;
  interest: number;
  late_interest: number;
  iva: number;
  iva_perception: number;
  iibb_perception: number;
  /** Booked (paid in the year being closed, before the system); null =
   *  stored only. */
  journal_entry_id: string | null;
}

export interface LoanDetail extends LoanListItem {
  installments: LoanInstallment[];
  bank_payments: LoanBankPayment[];
  /** The capital owed at the start of the fiscal year is booked. */
  opening_booked: boolean;
  /** Start of the current fiscal year: receipts from then on are booked. */
  book_from: string;
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

const rate = z.coerce
  .number()
  .min(0, "La tasa no puede ser negativa.")
  .max(1000, "Tasa inválida.")
  .nullable()
  .optional();

/** A cuota of the bank's plan (or computed): its split and whether it was
 *  paid before the loan is loaded. */
export const PlanInstallmentSchema = z.object({
  number: z.number().int().min(1),
  due_date: dateStr,
  amount: z.number().positive(),
  capital: z.number().min(0),
  interest: z.number().min(0),
  iva: z.number().min(0),
  perception: z.number().min(0),
  other: z.number().min(0),
  paid: z.boolean(),
});

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
  loan_number: optionalText(60),
  account_id: z.string().uuid().nullable().optional(),
  start_date: dateStr.nullable().optional(),
  original_amount: z.coerce.number().positive().nullable().optional(),
  tna: rate,
  tea: rate,
  cft: rate,
  /** The bank's plan, or the French plan from the TNA; without it the
   *  cuotas are equal parts of the capital. */
  plan: z.array(PlanInstallmentSchema).min(1).max(600).nullable().optional(),
});
export type CreateLoanInput = z.infer<typeof CreateLoanSchema>;

const splitPart = z.coerce.number().min(0, "No puede ser negativo.");

export const InstallmentSplitSchema = z.object({
  capital: splitPart,
  interest: splitPart,
  iva: splitPart,
  perception: splitPart,
  other: splitPart,
});

export const INSTALLMENT_ZERO_ERROR =
  "El monto de la cuota tiene que ser mayor a 0.";

// A cuota of $0 drops out of the schedule: neither the amount nor a split
// summing to 0 is a valid edit.
export const UpdateInstallmentSchema = z.object({
  id: z.string().uuid(),
  amount: z.coerce.number().positive(INSTALLMENT_ZERO_ERROR).optional(),
  due_date: dateStr.optional(),
  notes: optionalText(500),
  /** A split sets the amount to its sum; null removes the split. */
  split: InstallmentSplitSchema.refine((s) => splitTotal(s) > 0, {
    message: INSTALLMENT_ZERO_ERROR,
  })
    .nullable()
    .optional(),
});

export const AdoptInstallmentPaymentSchema = z.object({
  id: z.string().uuid(),
  transaction_id: z.string().uuid("Elegí el egreso."),
});

export const RecordDisbursementSchema = z
  .object({
    loan_id: z.string().uuid(),
    /** Adopt a manual income already loaded instead of writing a new one. */
    transaction_id: z.string().uuid().nullable().optional(),
    account_id: z.string().uuid().nullable().optional(),
    date: dateStr.nullable().optional(),
  })
  .refine((v) => !!v.transaction_id || (!!v.account_id && !!v.date), {
    message: "Elegí la cuenta y la fecha, o el ingreso ya cargado.",
  });

export const PayInstallmentSchema = z.object({
  id: z.string().uuid(),
  paid_date: dateStr,
  account_id: z.string().uuid("Cuenta requerida."),
  amount: z.coerce.number().positive("El monto debe ser mayor a 0."),
});

export const CancelLoanSchema = z.object({ id: z.string().uuid() });

const cents = z.number().min(0).max(1e12);

export const RecordBankPaymentsSchema = z.object({
  loan_id: z.string().uuid(),
  payments: z
    .array(
      z.object({
        loan_number: z.string().min(1).max(40),
        receipt_number: z.string().min(1).max(40),
        paid_date: dateStr,
        installment_number: z.number().int().min(1).max(600),
        total: z.number().positive().max(1e12),
        capital: cents,
        interest: cents,
        late_interest: cents,
        iva: cents,
        iva_perception: cents,
        iibb_perception: cents,
      }),
    )
    .min(1, "Elegí al menos un comprobante.")
    .max(500),
});

/** A cuota as the lender's statement bills it: its split and each charge. */
export const ApplyInstallmentStatementSchema = z.object({
  loan_id: z.string().uuid(),
  /** The contract number on the statement, checked against the loan's. */
  operation: z.string().max(40).nullable(),
  installment_number: z.number().int().min(1).max(600),
  capital: cents,
  interest: cents,
  iva: cents,
  charges: z
    .array(
      z.object({
        concept: z.enum(LEASING_CHARGE_CONCEPTS),
        description: z.string().trim().min(1).max(200),
        amount: cents,
        iva_amount: cents,
      }),
    )
    .max(50),
});

export const BookLoanOpeningSchema = z.object({ loan_id: z.string().uuid() });

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
