import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

// ─── Status ──────────────────────────────────────────────────────────────────

export const PAYROLL_STATUSES = ["draft", "closed"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = {
  draft: "Borrador",
  closed: "Cerrado",
};

// ─── Period ──────────────────────────────────────────────────────────────────

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
export type PayrollPeriod = Omit<PayrollPeriodRow, "status"> & {
  status: PayrollStatus;
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
  vacaciones_monto: moneyField.optional(),
  viaticos: moneyField.optional(),
  deudas: moneyField.optional(),
  telefono: moneyField.optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type UpdatePayrollEntryInput = z.infer<typeof UpdatePayrollEntrySchema>;

export type PayrollEntryResolved = {
  id: string;
  period_id: string;
  employee_id: string;
  employee_legal_name: string;
  employee_pay_frequency: string;
  employee_is_active: boolean;
  sueldo_neto: number;
  extras_total: number;
  vacaciones_monto: number;
  viaticos: number;
  deudas: number;
  telefono: number;
  total_a_pagar: number;
  paid_total: number;
  saldo: number;
  payments_count: number;
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

export const CreatePayrollPaymentSchema = z.object({
  entry_id: z.string().uuid(),
  account_id: z.string().uuid(),
  channel_id: z.string().trim().min(1, "Canal requerido."),
  amount: z.coerce.number().positive().max(999999999.99),
  method: z.enum(PAYROLL_PAYMENT_METHODS),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const DeletePayrollPaymentSchema = z.object({
  id: z.string().uuid(),
});

export type CreatePayrollPaymentInput = z.infer<
  typeof CreatePayrollPaymentSchema
>;

// Bulk payment: one transfer of N pesos to M employees → generates M
// payroll_payments rows (one per selected entry_id) with the same
// amount. The DB trigger creates M individual transactions in the chosen
// account. Useful for "I transferred 500k to each of these 10 drivers
// on the 15th of the month".
export const BulkCreatePayrollPaymentsSchema = z.object({
  entry_ids: z
    .array(z.string().uuid())
    .min(1, "Seleccioná al menos un empleado.")
    .max(100, "Demasiados pagos en un solo batch."),
  account_id: z.string().uuid(),
  channel_id: z.string().trim().min(1, "Canal requerido."),
  amount_each: z.coerce.number().positive().max(999999999.99),
  method: z.enum(PAYROLL_PAYMENT_METHODS),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type BulkCreatePayrollPaymentsInput = z.infer<
  typeof BulkCreatePayrollPaymentsSchema
>;

type PayrollPaymentRow =
  Database["public"]["Tables"]["payroll_payments"]["Row"];
export type PayrollPayment = Omit<PayrollPaymentRow, "method"> & {
  method: PayrollPaymentMethod;
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

export function formatPayrollPeriod(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1] ?? "??"} ${year}`;
}
