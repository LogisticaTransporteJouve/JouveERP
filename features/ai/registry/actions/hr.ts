import { z } from "zod";

import { listExpiringDocumentsAction } from "@/features/employee-documents/actions/employee-documents-actions";
import { getAttendanceMonthAction } from "@/features/hr/actions/attendance-actions";
import {
  listEmployeesAction,
  searchEmployeesAction,
} from "@/features/hr/actions/employees-actions";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, okResult } from "../result";

// Tool inputs stay loose; the underlying actions re-validate and gate
// (`hr:read`) + RLS, so the tool adds no new data access.

export async function runEmployees(): Promise<AiRunResult> {
  const res = await listEmployeesAction();
  if (!res.ok) return errResult(res.error);
  const active = res.data.filter((e) => e.is_active).length;
  return okResult(`${res.data.length} employees (${active} active).`, res.data);
}

export const getEmployees = defineAiAction({
  name: "getEmployees",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["employees"],
  description:
    "Employee roster: name, position, CUIL, pay frequency and status " +
    "(active/terminated). No parameters. For personnel or payroll.",
  input: z.object({}),
  run: () => runEmployees(),
});

export async function runSearchEmployees(input: {
  query?: string | null;
  onlyActive?: boolean | null;
  limit?: number | null;
}): Promise<AiRunResult> {
  const res = await searchEmployeesAction({
    query: input.query ?? "",
    onlyActive: input.onlyActive ?? true,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.employees.length} employees${
      res.data.nextOffset !== null ? " (more available, refine the search)" : ""
    }.`,
    res.data,
    { partial: res.data.nextOffset !== null },
  );
}

export const searchEmployees = defineAiAction({
  name: "searchEmployees",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["search_employees"],
  description:
    "Search employees by name or CUIL (full-text). Returns their data. Useful " +
    "to find the employee_id another tool requires or to resolve who the user " +
    "is referring to.",
  input: z.object({
    query: z.string().nullish().describe("Text to search: name or CUIL."),
    onlyActive: z.boolean().nullish().describe("Active only (default true)."),
    limit: z.number().nullish().describe("Max rows (default 25, max 200)."),
  }),
  run: (_ctx, input) => runSearchEmployees(input),
});

export async function runAttendance(input: {
  year: number;
  month: number;
}): Promise<AiRunResult> {
  const res = await getAttendanceMonthAction(input.year, input.month);
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.records.length} attendance events in ${String(
      input.month,
    ).padStart(2, "0")}/${input.year} · ${res.data.holidays.length} holidays.`,
    res.data,
  );
}

export const getAttendance = defineAiAction({
  name: "getAttendance",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["v_attendance_records_resolved", "holidays"],
  description:
    "Attendance for a month: events per employee (justified/unjustified " +
    "absences, late arrivals, leaves, sickness) + holidays. Requires year and " +
    "month.",
  input: z.object({
    year: z.number().describe("Year, e.g. 2026."),
    month: z.number().describe("Month 1-12."),
  }),
  run: (_ctx, input) => runAttendance(input),
});

export async function runExpiringDocuments(): Promise<AiRunResult> {
  const res = await listExpiringDocumentsAction();
  if (!res.ok) return errResult(res.error);
  const soonest = res.data[0];
  return okResult(
    `${res.data.length} documents expiring soon (≤30 days)${
      soonest ? ` · most urgent in ${soonest.days_until_expiry} days` : ""
    }.`,
    res.data,
  );
}

export const getExpiringDocuments = defineAiAction({
  name: "getExpiringDocuments",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["v_documents_expiring"],
  description:
    "Employee documents expiring within the next 30 days (licenses, health " +
    "cards, hazardous cargo courses, fitness certificates, etc.), from most " +
    "urgent to least. No parameters. For upcoming personnel paperwork expirations.",
  input: z.object({}),
  run: () => runExpiringDocuments(),
});
