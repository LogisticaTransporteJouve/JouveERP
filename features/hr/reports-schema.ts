import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import {
  IsoDateSchema,
  PeriodSchema,
  ScopeInputSchema,
  UuidSchema,
} from "@/lib/validation/common";

type Fn = Database["public"]["Functions"];

// Inputs of the HR / payroll aggregate reads. The `.describe()` texts double
// as the assistant's tool parameter docs (features/ai/registry).

const periodRange = {
  fromPeriod: PeriodSchema.describe("Período desde, YYYY-MM."),
  toPeriod: PeriodSchema.describe("Período hasta, YYYY-MM (inclusive)."),
};

const dateRange = {
  from: IsoDateSchema.describe("Fecha desde, YYYY-MM-DD."),
  to: IsoDateSchema.describe("Fecha hasta, YYYY-MM-DD (inclusive)."),
};

function orderedPeriods(v: { fromPeriod: string; toPeriod: string }): boolean {
  return v.fromPeriod <= v.toPeriod;
}

function orderedDates(v: { from: string; to: string }): boolean {
  return v.from <= v.to;
}

export const PayrollSummaryInputSchema = z
  .object({
    ...periodRange,
    groupBy: z
      .enum(["month", "employee"])
      .nullish()
      .describe("Agrupar por mes (default) o por empleado."),
    employeeId: UuidSchema.nullish().describe(
      "UUID de un empleado para filtrar (opcional).",
    ),
    scope: ScopeInputSchema,
  })
  .refine(orderedPeriods, "El período desde es posterior al período hasta.");

export const PayrollConceptsInputSchema = z
  .object({
    ...periodRange,
    driversOnly: z
      .boolean()
      .nullish()
      .describe("Solo choferes (pago semanal o vinculados a un chofer)."),
  })
  .refine(orderedPeriods, "El período desde es posterior al período hasta.");

export const PeriodRangeInputSchema = z
  .object(periodRange)
  .refine(orderedPeriods, "El período desde es posterior al período hasta.");

export const DateRangeInputSchema = z
  .object(dateRange)
  .refine(orderedDates, "La fecha desde es posterior a la fecha hasta.");

export const VacationOverviewInputSchema = z.object({
  asOf: IsoDateSchema.nullish().describe(
    "Fecha de corte, YYYY-MM-DD (default hoy).",
  ),
  expiringDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .nullish()
    .describe("Ventana en días para 'por vencer' (default 90)."),
});

export type PayrollSummaryRow = Fn["ai_payroll_summary"]["Returns"][number];
export type PayrollConceptRow = Fn["ai_payroll_concepts"]["Returns"][number];
export type DriverExtrasRow = Fn["ai_driver_extras"]["Returns"][number];
export type VacationOverviewRow = Fn["ai_vacation_overview"]["Returns"][number];
export type LeavesSummaryRow = Fn["ai_leaves_summary"]["Returns"][number];
export type AttendanceSummaryRow =
  Fn["ai_attendance_summary"]["Returns"][number];
