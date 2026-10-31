import { z } from "zod";

import { listPayrollPeriodsAction } from "@/features/hr/actions/payroll-actions";
import {
  getAttendanceSummaryAction,
  getDriverExtrasAction,
  getLeavesSummaryAction,
  getPayrollConceptsAction,
  getPayrollSummaryAction,
  getVacationOverviewAction,
} from "@/features/hr/actions/hr-reports-actions";
import {
  DateRangeInputSchema,
  PayrollConceptsInputSchema,
  PayrollSummaryInputSchema,
  PeriodRangeInputSchema,
  VacationOverviewInputSchema,
} from "@/features/hr/reports-schema";

import { defineAiAction } from "../define";
import { errResult, money, okResult, reachedCap } from "../result";
import { readScope } from "../scope";

// Payroll and HR aggregates. Each run calls a gated hr:read action over a
// security-invoker RPC; totals are summed in SQL, never over listed rows.

const PAYROLL_NOTE =
  "Montos netos de planilla: el sistema no guarda sueldo bruto ni cargas sociales.";

function sumBy<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((s, r) => s + pick(r), 0);
}

export const getPayrollSummary = defineAiAction({
  name: "getPayrollSummary",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["ai_payroll_summary", "v_payroll_entries_with_payments"],
  description:
    "Totales de sueldos por mes o por empleado en un rango de períodos: sueldo neto, extras, vacaciones, viáticos, descuentos (deudas, teléfono), total a pagar, pagado y saldo. Montos netos (no hay bruto ni cargas sociales). Las liquidaciones no tienen canal: el alcance opcional (fiscal/internal/all) solo filtra lo pagado, por el canal de cada pago; el saldo es siempre el real.",
  input: PayrollSummaryInputSchema,
  run: async (_ctx, input) => {
    const { label } = readScope(input.scope);
    const res = await getPayrollSummaryAction(input);
    if (!res.ok) return errResult(res.error);
    const rows = res.data;
    // Rows partition the range (by month or by employee), so adding the
    // per-group SQL totals gives the range total. `saldo` comes from SQL:
    // with a scope, `paid` is that scope's payments only, so total − paid
    // would not be the balance.
    const total = sumBy(rows, (r) => r.total_a_pagar);
    const paid = sumBy(rows, (r) => r.paid);
    const saldo = sumBy(rows, (r) => r.saldo);
    return okResult(
      `Sueldos ${input.fromPeriod}→${input.toPeriod}: ${rows.length} ${
        input.groupBy === "employee" ? "empleados" : "meses"
      } · total a pagar ${money(total)} · pagado (${label}) ${money(
        paid,
      )} · saldo ${money(saldo)}.`,
      { rows, totals: { total_a_pagar: total, paid, saldo } },
      { currency: "ARS", note: PAYROLL_NOTE },
    );
  },
});

export const getPayrollConcepts = defineAiAction({
  name: "getPayrollConcepts",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["ai_payroll_concepts", "payroll_entries", "payroll_entry_extras"],
  description:
    "Sueldos por concepto en un rango de períodos: conceptos fijos (sueldo neto, vacaciones, viáticos; deudas y teléfono en negativo) y cada extra/horas extra agrupado por descripción. Opción solo choferes.",
  input: PayrollConceptsInputSchema,
  run: async (_ctx, input) => {
    const res = await getPayrollConceptsAction(input);
    if (!res.ok) return errResult(res.error);
    const extras = res.data.filter((r) => r.kind === "extra");
    return okResult(
      `${res.data.length} conceptos ${input.fromPeriod}→${input.toPeriod} · ` +
        `extras ${money(sumBy(extras, (r) => r.amount))} en ${extras.length} conceptos.`,
      { rows: res.data },
      {
        currency: "ARS",
        partial: reachedCap(res.data.length, 200),
        note: PAYROLL_NOTE,
      },
    );
  },
});

export const getDriverExtras = defineAiAction({
  name: "getDriverExtras",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["ai_driver_extras", "v_payroll_entries_resolved"],
  description:
    "Extras de choferes por chofer y mes (empleados de pago semanal o vinculados a un chofer): total y cantidad de extras, viáticos, sueldo neto y total a pagar.",
  input: PeriodRangeInputSchema,
  run: async (_ctx, input) => {
    const res = await getDriverExtrasAction(input);
    if (!res.ok) return errResult(res.error);
    const drivers = new Set(res.data.map((r) => r.employee_id)).size;
    return okResult(
      `${drivers} choferes · extras ${money(
        sumBy(res.data, (r) => r.extras_total),
      )} en ${input.fromPeriod}→${input.toPeriod}.`,
      { rows: res.data },
      {
        currency: "ARS",
        partial: reachedCap(res.data.length),
        note: PAYROLL_NOTE,
      },
    );
  },
});

export const getVacationOverview = defineAiAction({
  name: "getVacationOverview",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: [
    "ai_vacation_overview",
    "employee_vacation_balances",
    "employee_leaves",
  ],
  description:
    "Saldo de vacaciones por empleado activo: días que corresponden, tomados, pendientes, por vencer (ventana configurable) y próximo vencimiento, más días tomados en el año.",
  input: VacationOverviewInputSchema,
  run: async (_ctx, input) => {
    const res = await getVacationOverviewAction(input);
    if (!res.ok) return errResult(res.error);
    const expiring = res.data.filter((r) => r.expiring_days > 0);
    return okResult(
      `${res.data.length} empleados · ${sumBy(
        res.data,
        (r) => r.remaining_days,
      )} días pendientes · ${expiring.length} con días por vencer.`,
      { rows: res.data },
    );
  },
});

export const getLeavesSummary = defineAiAction({
  name: "getLeavesSummary",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["ai_leaves_summary", "employee_leaves"],
  description:
    "Licencias y ausencias por empleado y tipo (vacaciones, enfermedad, franco, maternidad, paternidad, otro) en un rango de fechas: cantidad y días dentro del rango.",
  input: DateRangeInputSchema,
  run: async (_ctx, input) => {
    const res = await getLeavesSummaryAction(input);
    if (!res.ok) return errResult(res.error);
    return okResult(
      `${res.data.length} filas empleado×tipo · ${sumBy(
        res.data,
        (r) => r.days,
      )} días de licencia entre ${input.from} y ${input.to}.`,
      { rows: res.data },
      { partial: reachedCap(res.data.length) },
    );
  },
});

export const getAttendanceSummary = defineAiAction({
  name: "getAttendanceSummary",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["ai_attendance_summary", "attendance_records"],
  description:
    "Resumen de asistencia por empleado y tipo de evento (ausencias justificadas/injustificadas, llegadas tarde, retiros, enfermedad, licencia) en un rango de fechas, con horas perdidas.",
  input: DateRangeInputSchema,
  run: async (_ctx, input) => {
    const res = await getAttendanceSummaryAction(input);
    if (!res.ok) return errResult(res.error);
    return okResult(
      `${sumBy(res.data, (r) => r.events)} eventos · ${sumBy(
        res.data,
        (r) => r.hours_lost,
      )} horas perdidas entre ${input.from} y ${input.to}.`,
      { rows: res.data },
      { partial: reachedCap(res.data.length) },
    );
  },
});

export const getPayrollPeriods = defineAiAction({
  name: "getPayrollPeriods",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["payroll_periods"],
  description:
    "Períodos de liquidación de sueldos (año, mes, estado borrador/cerrado, fecha de cierre). Sin parámetros.",
  input: z.object({}),
  run: async () => {
    const res = await listPayrollPeriodsAction();
    if (!res.ok) return errResult(res.error);
    const open = res.data.filter((p) => p.status === "draft").length;
    return okResult(
      `${res.data.length} períodos de liquidación (${open} en borrador).`,
      res.data,
    );
  },
});
