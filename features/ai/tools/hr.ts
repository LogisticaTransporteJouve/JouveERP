import { tool } from "ai";
import { z } from "zod";

import { listExpiringDocumentsAction } from "@/features/employee-documents/actions/employee-documents-actions";
import { getAttendanceMonthAction } from "@/features/hr/actions/attendance-actions";
import {
  listEmployeesAction,
  searchEmployeesAction,
} from "@/features/hr/actions/employees-actions";

import { type AiToolResult, errResult, okResult } from "./result";

// Tool inputs stay loose; the underlying actions re-validate and gate
// (`hr:read`) + RLS, so the tool adds no new data access.

export async function runEmployees(): Promise<AiToolResult> {
  const res = await listEmployeesAction();
  if (!res.ok) return errResult(res.error);
  const active = res.data.filter((e) => e.is_active).length;
  return okResult(`${res.data.length} empleados (${active} activos).`, res.data);
}

export const getEmployees = tool({
  description:
    "Nómina de empleados: nombre, puesto, CUIL, frecuencia de pago y estado " +
    "(activo/baja). Sin parámetros. Para personal o sueldos.",
  inputSchema: z.object({}),
  execute: () => runEmployees(),
});

export async function runSearchEmployees(input: {
  query?: string | null;
  onlyActive?: boolean | null;
  limit?: number | null;
}): Promise<AiToolResult> {
  const res = await searchEmployeesAction({
    query: input.query ?? "",
    onlyActive: input.onlyActive ?? true,
    limit: input.limit ?? 25,
  });
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.employees.length} empleados${
      res.data.nextOffset !== null ? " (hay más, afiná la búsqueda)" : ""
    }.`,
    res.data,
  );
}

export const searchEmployees = tool({
  description:
    "Busca empleados por nombre o CUIL (full-text). Devuelve sus datos. Útil " +
    "para encontrar el employee_id que pide otra tool o resolver a quién se " +
    "refiere el usuario.",
  inputSchema: z.object({
    query: z.string().nullish().describe("Texto a buscar: nombre o CUIL."),
    onlyActive: z.boolean().nullish().describe("Solo activos (default true)."),
    limit: z.number().nullish().describe("Máximo de filas (default 25, máx 200)."),
  }),
  execute: (input) => runSearchEmployees(input),
});

export async function runAttendance(input: {
  year: number;
  month: number;
}): Promise<AiToolResult> {
  const res = await getAttendanceMonthAction(input.year, input.month);
  if (!res.ok) return errResult(res.error);
  return okResult(
    `${res.data.records.length} novedades de asistencia en ${String(
      input.month,
    ).padStart(2, "0")}/${input.year} · ${res.data.holidays.length} feriados.`,
    res.data,
  );
}

export const getAttendance = tool({
  description:
    "Asistencia de un mes: novedades por empleado (ausencias justificadas/" +
    "injustificadas, llegadas tarde, licencias, enfermedad) + feriados. Requiere " +
    "año y mes.",
  inputSchema: z.object({
    year: z.number().describe("Año, ej. 2026."),
    month: z.number().describe("Mes 1-12."),
  }),
  execute: (input) => runAttendance(input),
});

export async function runExpiringDocuments(): Promise<AiToolResult> {
  const res = await listExpiringDocumentsAction();
  if (!res.ok) return errResult(res.error);
  const soonest = res.data[0];
  return okResult(
    `${res.data.length} documentos por vencer (≤30 días)${
      soonest ? ` · más urgente en ${soonest.days_until_expiry} días` : ""
    }.`,
    res.data,
  );
}

export const getExpiringDocuments = tool({
  description:
    "Documentos de empleados por vencer en los próximos 30 días (licencias, " +
    "libreta sanitaria, cursos de cargas peligrosas, aptitudes, etc.), del más " +
    "urgente al menos. Sin parámetros. Para vencimientos de papeles del personal.",
  inputSchema: z.object({}),
  execute: () => runExpiringDocuments(),
});
