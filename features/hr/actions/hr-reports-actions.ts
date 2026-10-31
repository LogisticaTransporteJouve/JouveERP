"use server";

import { gatedRead } from "@/lib/actions/gated-read";
import type { ActionResult } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";

import {
  DateRangeInputSchema,
  PayrollConceptsInputSchema,
  PayrollSummaryInputSchema,
  PeriodRangeInputSchema,
  VacationOverviewInputSchema,
  type AttendanceSummaryRow,
  type DriverExtrasRow,
  type LeavesSummaryRow,
  type PayrollConceptRow,
  type PayrollSummaryRow,
  type VacationOverviewRow,
} from "../reports-schema";

// Payroll / HR aggregates over security-invoker RPCs (payroll and HR RLS
// apply), gated on hr:read like every payroll read.

const HR_READ = {
  permissions: ["hr:read"],
  denied: "Sin permiso para ver liquidaciones y RRHH.",
  failure: "No se pudo calcular el reporte de RRHH.",
} as const;

export async function getPayrollSummaryAction(
  input: unknown,
): Promise<ActionResult<PayrollSummaryRow[]>> {
  return gatedRead({
    ...HR_READ,
    schema: PayrollSummaryInputSchema,
    input,
    event: "hr.payroll_summary.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_payroll_summary", {
        p_from_period: v.fromPeriod,
        p_to_period: v.toPeriod,
        p_group_by: v.groupBy ?? "month",
        p_employee_id: v.employeeId ?? undefined,
        p_is_fiscal: isFiscalFor(v.scope ?? "all") ?? undefined,
      }),
  });
}

export async function getPayrollConceptsAction(
  input: unknown,
): Promise<ActionResult<PayrollConceptRow[]>> {
  return gatedRead({
    ...HR_READ,
    schema: PayrollConceptsInputSchema,
    input,
    event: "hr.payroll_concepts.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_payroll_concepts", {
        p_from_period: v.fromPeriod,
        p_to_period: v.toPeriod,
        p_drivers_only: v.driversOnly ?? false,
      }),
  });
}

export async function getDriverExtrasAction(
  input: unknown,
): Promise<ActionResult<DriverExtrasRow[]>> {
  return gatedRead({
    ...HR_READ,
    schema: PeriodRangeInputSchema,
    input,
    event: "hr.driver_extras.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_driver_extras", {
        p_from_period: v.fromPeriod,
        p_to_period: v.toPeriod,
      }),
  });
}

export async function getVacationOverviewAction(
  input: unknown,
): Promise<ActionResult<VacationOverviewRow[]>> {
  return gatedRead({
    ...HR_READ,
    schema: VacationOverviewInputSchema,
    input,
    event: "hr.vacation_overview.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_vacation_overview", {
        p_as_of: v.asOf ?? undefined,
        p_expiring_days: v.expiringDays ?? undefined,
      }),
  });
}

export async function getLeavesSummaryAction(
  input: unknown,
): Promise<ActionResult<LeavesSummaryRow[]>> {
  return gatedRead({
    ...HR_READ,
    schema: DateRangeInputSchema,
    input,
    event: "hr.leaves_summary.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_leaves_summary", { p_from: v.from, p_to: v.to }),
  });
}

export async function getAttendanceSummaryAction(
  input: unknown,
): Promise<ActionResult<AttendanceSummaryRow[]>> {
  return gatedRead({
    ...HR_READ,
    schema: DateRangeInputSchema,
    input,
    event: "hr.attendance_summary.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_attendance_summary", { p_from: v.from, p_to: v.to }),
  });
}
