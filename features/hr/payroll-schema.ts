import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

import type { PayMode } from "./schema";

// ─── Status ──────────────────────────────────────────────────────────────────

export const PAYROLL_STATUSES = ["draft", "closed"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = {
  draft: "Borrador",
  closed: "Cerrado",
};

// ─── Kind ────────────────────────────────────────────────────────────────────

/** A monthly planilla, or the SAC (aguinaldo) of a half year. A SAC period
 *  sits on the month it is due: 6 for the first half, 12 for the second. */
export const PAYROLL_PERIOD_KINDS = ["monthly", "sac"] as const;
export type PayrollPeriodKind = (typeof PAYROLL_PERIOD_KINDS)[number];

export function isPayrollPeriodKind(
  value: unknown,
): value is PayrollPeriodKind {
  return (
    typeof value === "string" &&
    (PAYROLL_PERIOD_KINDS as readonly string[]).includes(value)
  );
}

export type SacHalf = 1 | 2;

export function sacMonth(half: SacHalf): 6 | 12 {
  return half === 1 ? 6 : 12;
}

export function sacHalfOfMonth(month: number): SacHalf {
  return month <= 6 ? 1 : 2;
}

// ─── Period ──────────────────────────────────────────────────────────────────

export const SeedSacPeriodSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2099),
  half: z.union([z.literal(1), z.literal(2)]),
});

export const SeedPayrollPeriodSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2099),
  month: z.coerce.number().int().min(1).max(12),
});

export const ClosePayrollPeriodSchema = z.object({
  id: z.string().uuid(),
});

export const ReopenPayrollPeriodSchema = z.object({
  id: z.string().uuid(),
});

export type SeedPayrollPeriodInput = z.infer<typeof SeedPayrollPeriodSchema>;
export type ClosePayrollPeriodInput = z.infer<typeof ClosePayrollPeriodSchema>;

type PayrollPeriodRow = Database["public"]["Tables"]["payroll_periods"]["Row"];
// posts_employee_accounts and posts_receipt_gap are the database's alone
// (closing writes the account and the recibo gap entry).
export type PayrollPeriod = Omit<
  PayrollPeriodRow,
  "status" | "kind" | "posts_employee_accounts" | "posts_receipt_gap"
> & {
  status: PayrollStatus;
  kind: PayrollPeriodKind;
};

export function isPayrollStatus(value: unknown): value is PayrollStatus {
  return (
    typeof value === "string" &&
    (PAYROLL_STATUSES as readonly string[]).includes(value)
  );
}

// ─── Entry ───────────────────────────────────────────────────────────────────

const moneyField = z.coerce.number().min(0).max(999999999.99);

export const UpdatePayrollEntrySchema = z.object({
  id: z.string().uuid(),
  sueldo_neto: moneyField.optional(),
  viaticos: moneyField.optional(),
  deudas: moneyField.optional(),
  telefono: moneyField.optional(),
  embargo: moneyField.optional(),
  /** The liquidador's receipt net; null clears it. */
  recibo_neto: moneyField.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type UpdatePayrollEntryInput = z.infer<typeof UpdatePayrollEntrySchema>;

/** Drops a hand-typed Deudas (back to the plans' installments) or Embargo
 *  (back to the employee's garnishments). */
export const ResetPayrollOverrideSchema = z.object({
  id: z.string().uuid(),
  field: z.enum(["deudas", "embargo"]),
});

export type PayrollOverrideField = z.infer<
  typeof ResetPayrollOverrideSchema
>["field"];

export type PayrollEntryResolved = {
  id: string;
  period_id: string;
  employee_id: string;
  employee_legal_name: string;
  employee_pay_frequency: string;
  /** recibo: the database copies the recibo into the sueldo. */
  employee_pay_mode: PayMode;
  employee_is_active: boolean;
  sueldo_neto: number;
  extras_total: number;
  viaticos: number;
  deudas: number;
  /** true = Deudas typed by hand for this period; false = the installments of
   *  the employee's active plans (computed by the database). */
  deudas_override: boolean;
  telefono: number;
  embargo: number;
  /** true = Embargo typed by hand for this period; false = computed from the
   *  employee's garnishments. */
  embargo_override: boolean;
  /** The liquidador's receipt net; null while it is not loaded. */
  recibo_neto: number | null;
  total_a_pagar: number;
  paid_total: number;
  paid_transferencia: number;
  paid_efectivo: number;
  saldo: number;
  payments_count: number;
  /** What the books carry: recibo − embargo (payroll_fiscal_share). */
  fiscal_share: number;
  /** Paid on the fiscal channel (books) and on the internal one (management);
   *  the database assigns each payment's channel. */
  paid_fiscal: number;
  paid_internal: number;
  notes: string | null;
};

// ─── Payments ────────────────────────────────────────────────────────────────

export const PAYROLL_PAYMENT_METHODS = ["transferencia", "efectivo"] as const;
export type PayrollPaymentMethod = (typeof PAYROLL_PAYMENT_METHODS)[number];

export const PAYROLL_PAYMENT_METHOD_LABEL: Record<
  PayrollPaymentMethod,
  string
> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
};

// No channel: the database assigns each payment's channel by the recibo
// (recibo − embargo to the books, the rest to management) and may split a
// payment in two. Non-strict objects strip a channel_id sent by older
// clients or stored assistant drafts.
export const CreatePayrollPaymentSchema = z.object({
  entry_id: z.string().uuid(),
  account_id: z.string().uuid(),
  amount: z.coerce.number().positive().max(999999999.99),
  method: z.enum(PAYROLL_PAYMENT_METHODS),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  notes: z.string().trim().max(500).nullable().optional(),
  /** The user confirmed paying more than the entry's balance. */
  allow_overpay: z.boolean().optional(),
});

export const UpdatePayrollPaymentSchema = CreatePayrollPaymentSchema.omit({
  entry_id: true,
}).extend({ id: z.string().uuid() });

export type UpdatePayrollPaymentInput = z.infer<
  typeof UpdatePayrollPaymentSchema
>;

export const DeletePayrollPaymentSchema = z.object({
  id: z.string().uuid(),
});

export const AddMissingPayrollEntriesSchema = z.object({
  period_id: z.string().uuid(),
});

export type CreatePayrollPaymentInput = z.infer<
  typeof CreatePayrollPaymentSchema
>;

// Bulk payment: one payroll_payment per selected entry, each with its own
// amount, from one account and method. The DB trigger creates one
// transaction per payment, as a single payment would.
export const BulkCreatePayrollPaymentsSchema = z.object({
  items: z
    .array(
      z.object({
        entry_id: z.string().uuid(),
        amount: z.coerce.number().positive().max(999999999.99),
      }),
    )
    .min(1, "Seleccioná al menos un empleado.")
    .max(100, "Demasiados pagos en un solo batch.")
    .refine(
      (items) => new Set(items.map((i) => i.entry_id)).size === items.length,
      "Un empleado figura dos veces en el pago.",
    ),
  account_id: z.string().uuid(),
  method: z.enum(PAYROLL_PAYMENT_METHODS),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  notes: z.string().trim().max(500).nullable().optional(),
  /** The user confirmed paying more than some employees' balance. */
  allow_overpay: z.boolean().optional(),
});

export type BulkCreatePayrollPaymentsInput = z.infer<
  typeof BulkCreatePayrollPaymentsSchema
>;

type PayrollPaymentRow =
  Database["public"]["Tables"]["payroll_payments"]["Row"];
/** split_parent_id set = the internal piece of the payment it names (the
 *  part beyond the books' share); the user edits and deletes the parent. */
export type PayrollPayment = Omit<PayrollPaymentRow, "method"> & {
  method: PayrollPaymentMethod;
};

/** A payment as the payroll dialog lists it: its channel side and whether
 *  its movement is reconciled with the bank statement. */
export type PayrollPaymentListed = PayrollPayment & {
  is_fiscal: boolean;
  reconciled: boolean;
};

export function isPayrollPaymentMethod(
  value: unknown,
): value is PayrollPaymentMethod {
  return (
    typeof value === "string" &&
    (PAYROLL_PAYMENT_METHODS as readonly string[]).includes(value)
  );
}

// ─── Extras ──────────────────────────────────────────────────────────────────

export const AddPayrollEntryExtraSchema = z.object({
  entry_id: z.string().uuid(),
  amount: z.coerce.number().positive().max(999999999.99),
  description: z.string().trim().min(1, "Descripción requerida.").max(200),
});

export const RemovePayrollEntryExtraSchema = z.object({
  id: z.string().uuid(),
});

export type AddPayrollEntryExtraInput = z.infer<
  typeof AddPayrollEntryExtraSchema
>;

type PayrollEntryExtraRow =
  Database["public"]["Tables"]["payroll_entry_extras"]["Row"];
export type PayrollEntryExtra = PayrollEntryExtraRow;

// ─── Convenience helpers ─────────────────────────────────────────────────────

export const MONTH_LABELS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

export function formatPayrollPeriod(
  year: number,
  month: number,
  kind: PayrollPeriodKind = "monthly",
): string {
  if (kind === "sac") {
    return `SAC ${sacHalfOfMonth(month) === 1 ? "1.er" : "2.º"} semestre ${year}`;
  }
  return `${MONTH_LABELS[month - 1] ?? "??"} ${year}`;
}

/** Route of a period's planilla. */
export function payrollPeriodHref(
  year: number,
  month: number,
  kind: PayrollPeriodKind = "monthly",
): string {
  return kind === "sac"
    ? `/hr/payroll/sac/${year}/${sacHalfOfMonth(month)}`
    : `/hr/payroll/${year}/${month}`;
}

// ─── Garnishments (embargos) ─────────────────────────────────────────────────

export const GARNISHMENT_MODES = ["percentage", "fixed"] as const;
export type GarnishmentMode = (typeof GARNISHMENT_MODES)[number];

export const GARNISHMENT_MODE_LABEL: Record<GarnishmentMode, string> = {
  percentage: "Porcentaje del recibo",
  fixed: "Monto fijo",
};

export function isGarnishmentMode(value: unknown): value is GarnishmentMode {
  return (
    typeof value === "string" &&
    (GARNISHMENT_MODES as readonly string[]).includes(value)
  );
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const garnishmentFields = z.object({
  mode: z.enum(GARNISHMENT_MODES),
  value: z.coerce
    .number()
    .positive("El valor tiene que ser mayor a 0.")
    .max(999999999.99),
  active_from: isoDate,
  active_to: isoDate.nullable().optional(),
  beneficiary: optionalText(200),
  court_note: optionalText(500),
});

function refineGarnishment(
  v: z.infer<typeof garnishmentFields>,
  ctx: z.RefinementCtx,
) {
  if (v.mode === "percentage" && v.value > 100) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: "El porcentaje no puede superar 100.",
    });
  }
  if (v.active_to && v.active_to < v.active_from) {
    ctx.addIssue({
      code: "custom",
      path: ["active_to"],
      message: "La fecha de fin es anterior al inicio.",
    });
  }
}

export const CreateGarnishmentSchema = garnishmentFields
  .extend({ employee_id: z.string().uuid() })
  .superRefine(refineGarnishment);

export const UpdateGarnishmentSchema = garnishmentFields
  .extend({ id: z.string().uuid() })
  .superRefine(refineGarnishment);

export const DeleteGarnishmentSchema = z.object({ id: z.string().uuid() });

export type CreateGarnishmentInput = z.infer<typeof CreateGarnishmentSchema>;

export type Garnishment = {
  id: string;
  employee_id: string;
  mode: GarnishmentMode;
  percentage: number | null;
  amount: number | null;
  active_from: string;
  active_to: string | null;
  beneficiary: string | null;
  court_note: string | null;
};

/** Whether a garnishment applies to some day of the month. */
export function garnishmentActiveInMonth(
  g: Pick<Garnishment, "active_from" | "active_to">,
  year: number,
  month: number,
): boolean {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return (
    g.active_from <= last && (g.active_to === null || g.active_to >= first)
  );
}

// ─── Final settlement (liquidación final) ────────────────────────────────────

export const ApplyFinalSettlementSchema = z.object({
  employee_id: z.string().uuid(),
  prorated_salary: moneyField,
  vacation_amount: moneyField,
  vacation_days: z.coerce.number().min(0).max(365),
  sac_amount: moneyField,
});

export type ApplyFinalSettlementInput = z.infer<
  typeof ApplyFinalSettlementSchema
>;
