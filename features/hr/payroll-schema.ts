import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const PAYROLL_PATH = "/hr/payroll";

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
  notes: string | null;
};

// ─── Extras ──────────────────────────────────────────────────────────────────

export const AddPayrollEntryExtraSchema = z.object({
  entry_id: z.string().uuid(),
  amount: z.coerce.number().positive().max(999999999.99),
  description: z.string().trim().min(1, "Descripción requerida.").max(200),
});

export const UpdatePayrollEntryExtraSchema = z.object({
  id: z.string().uuid(),
  amount: z.coerce.number().positive().max(999999999.99).optional(),
  description: z.string().trim().min(1).max(200).optional(),
});

export const RemovePayrollEntryExtraSchema = z.object({
  id: z.string().uuid(),
});

export type AddPayrollEntryExtraInput = z.infer<
  typeof AddPayrollEntryExtraSchema
>;
export type UpdatePayrollEntryExtraInput = z.infer<
  typeof UpdatePayrollEntryExtraSchema
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
