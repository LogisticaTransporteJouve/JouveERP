import { z } from "zod";

import {
  getEmployeeAccountAction,
  listEmployeeAccountBalancesAction,
} from "@/features/hr/actions/employee-account-actions";
import { getFinalSettlementAction } from "@/features/hr/actions/final-settlement-actions";
import { listGarnishmentsAction } from "@/features/hr/actions/garnishments-actions";
import {
  getPayrollPeriodAction,
  listPayrollPeriodsAction,
} from "@/features/hr/actions/payroll-actions";
import { listSalaryChangesAction } from "@/features/hr/actions/salary-actions";
import { getPeriodTripExtrasAction } from "@/features/hr/actions/trip-extras-actions";
import { listLeavesByRangeAction } from "@/features/hr/actions/vacations-actions";
import { LeavesByRangeInputSchema } from "@/features/hr/vacation-schema";
import { payrollOtros, suggestedSplit } from "@/features/hr/lib/payroll-split";
import { formatPayrollPeriod, sacMonth } from "@/features/hr/payroll-schema";
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
import { round2 } from "@/lib/format";

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
    "Totales de sueldos por mes o por empleado en un rango de períodos: sueldo neto, extras, vacaciones, viáticos, descuentos (deudas, teléfono, embargo), total a pagar, pagado y saldo. El SAC (aguinaldo) cuenta en junio y diciembre. Montos netos (no hay bruto ni cargas sociales). Las liquidaciones no tienen canal: el alcance opcional (fiscal/internal/all) solo filtra lo pagado, por el canal de cada pago; el saldo es siempre el real, de todos los canales (con alcance, totals.paid_other_channels es lo pagado por los otros canales: paid + paid_other_channels + saldo = total_a_pagar).",
  input: PayrollSummaryInputSchema,
  run: async (_ctx, input) => {
    const { isFiscal, label } = readScope(input.scope);
    const res = await getPayrollSummaryAction(input);
    if (!res.ok) return errResult(res.error);
    const rows = res.data;
    // Rows partition the range (by month or by employee), so adding the
    // per-group SQL totals gives the range total. `saldo` comes from SQL and
    // covers every channel: with a scope, `paid` is that scope's payments
    // only, so what the other channels paid is shown apart and
    // paid + paid_other_channels + saldo = total_a_pagar.
    const total = sumBy(rows, (r) => r.total_a_pagar);
    const paid = sumBy(rows, (r) => r.paid);
    const saldo = sumBy(rows, (r) => r.saldo);
    const paidOther = isFiscal === null ? null : round2(total - paid - saldo);
    return okResult(
      `Sueldos ${input.fromPeriod}→${input.toPeriod}: ${rows.length} ${
        input.groupBy === "employee" ? "empleados" : "meses"
      } · total a pagar ${money(total)} · pagado (${label}) ${money(paid)}${
        paidOther === null
          ? ""
          : ` · pagado por los otros canales ${money(paidOther)}`
      } · saldo (todos los canales) ${money(saldo)}.`,
      {
        rows,
        totals: {
          total_a_pagar: total,
          paid,
          ...(paidOther === null ? {} : { paid_other_channels: paidOther }),
          saldo,
        },
      },
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
    "Sueldos por concepto en un rango de períodos: conceptos fijos (sueldo neto, vacaciones, viáticos; deudas, teléfono y embargo en negativo) y cada extra/horas extra agrupado por descripción. Opción solo choferes.",
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
    "Saldo de vacaciones por empleado activo: días que corresponden, tomados, pendientes, por vencer (ventana configurable) y próximo vencimiento, más días tomados en el año. Con employee (nombre o employee_id), solo ese empleado: para «¿cuántas vacaciones le quedan a X?».",
  input: VacationOverviewInputSchema,
  run: async (_ctx, input) => {
    const res = await getVacationOverviewAction(input);
    if (!res.ok) return errResult(res.error);
    const expiring = res.data.filter((r) => r.expiring_days > 0);
    if (input.employee && res.data.length === 0) {
      return okResult(
        `Ningún empleado activo coincide con «${input.employee}»: buscalo con searchEmployees.`,
        { rows: [] },
      );
    }
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

export const getLeavesByRange = defineAiAction({
  name: "getLeavesByRange",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["employee_leaves", "employees"],
  description:
    "Licencias de un período, una por fila: cada licencia (vacaciones, enfermedad, franco, maternidad, paternidad, otro) que se superpone con el rango, con empleado, tipo, desde, hasta, días corridos totales y días dentro del rango. De todos los empleados o de uno (employeeId), de todos los tipos o de uno (kind). Para ver quién se toma vacaciones en un mes como calendario, llamá renderCalendar con esta consulta.",
  input: LeavesByRangeInputSchema,
  run: async (_ctx, input) => {
    const res = await listLeavesByRangeAction(input);
    if (!res.ok) return errResult(res.error);
    const { rows, partial } = res.data;
    const employees = new Set(rows.map((r) => r.employee_id)).size;
    return okResult(
      `${rows.length} licencias de ${employees} empleados entre ${input.from} y ${input.to} · ${sumBy(
        rows,
        (r) => r.days_in_range,
      )} días dentro del rango.`,
      { rows },
      { partial },
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
    "Períodos de liquidación de sueldos: mensuales y de SAC (aguinaldo, kind 'sac' en el mes 6 o 12), con año, mes, estado borrador/cerrado y fecha de cierre. Sin parámetros.",
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

export const getPayrollPeriodDetail = defineAiAction({
  name: "getPayrollPeriodDetail",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["payroll_periods", "v_payroll_entries_with_payments"],
  description:
    "Planilla de un período, por empleado: sueldo pactado, neto del recibo del liquidador, otros (pactado − recibo), extras, vacaciones, viáticos, descuentos y embargo, total, pagado (por transferencia y efectivo), saldo y el reparto sugerido (transferencia = recibo − embargo − descuentos; efectivo = el resto). Para el SAC usá kind 'sac' con month 6 (1.er semestre) o 12 (2.º).",
  input: z.object({
    year: z.number().int().describe("Año, ej. 2026."),
    month: z.number().int().min(1).max(12).describe("Mes 1-12."),
    kind: z
      .enum(["monthly", "sac"])
      .nullish()
      .describe("monthly (default) o sac."),
  }),
  run: async (_ctx, input) => {
    const kind = input.kind ?? "monthly";
    const month =
      kind === "sac" ? sacMonth(input.month <= 6 ? 1 : 2) : input.month;
    const res = await getPayrollPeriodAction(input.year, month, kind);
    if (!res.ok) return errResult(res.error);
    const label = formatPayrollPeriod(input.year, month, kind);
    if (!res.data.period) {
      return okResult(`No hay planilla de ${label}.`, {
        period: null,
        rows: [],
      });
    }
    const rows = res.data.entries.map((e) => ({
      employee_id: e.employee_id,
      employee: e.employee_legal_name,
      sueldo_pactado: e.sueldo_neto,
      recibo_neto: e.recibo_neto,
      otros: payrollOtros(e),
      extras: e.extras_total,
      vacaciones: e.vacaciones_monto,
      viaticos: e.viaticos,
      deudas: e.deudas,
      telefono: e.telefono,
      embargo: e.embargo,
      total_a_pagar: e.total_a_pagar,
      pagado: e.paid_total,
      pagado_transferencia: e.paid_transferencia,
      pagado_efectivo: e.paid_efectivo,
      saldo: e.saldo,
      sugerido: suggestedSplit(e),
    }));
    const withoutReceipt = rows.filter((r) => r.recibo_neto === null).length;
    return okResult(
      `${label} (${res.data.period.status === "closed" ? "cerrada" : "borrador"}): ${rows.length} empleados · total ${money(
        sumBy(rows, (r) => r.total_a_pagar),
      )} · saldo ${money(sumBy(rows, (r) => r.saldo))} · embargos ${money(
        sumBy(rows, (r) => r.embargo),
      )}${withoutReceipt > 0 ? ` · ${withoutReceipt} sin recibo cargado` : ""}.`,
      { period: res.data.period, rows },
      { currency: "ARS", note: PAYROLL_NOTE },
    );
  },
});

export const getGarnishments = defineAiAction({
  name: "getGarnishments",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["employee_garnishments"],
  description:
    "Embargos sobre sueldos: porcentaje del neto del recibo o monto fijo, vigencia (desde/hasta), beneficiario y juzgado. De un empleado o de todos.",
  input: z.object({
    employeeId: z
      .string()
      .uuid()
      .nullish()
      .describe("employee_id (de searchEmployees); vacío = todos."),
  }),
  run: async (_ctx, input) => {
    const res = await listGarnishmentsAction(input.employeeId ?? undefined);
    if (!res.ok) return errResult(res.error);
    const open = res.data.filter((g) => g.active_to === null).length;
    return okResult(
      `${res.data.length} embargos (${open} sin fecha de fin).`,
      res.data,
      { partial: reachedCap(res.data.length, 500) },
    );
  },
});

export const getFinalSettlement = defineAiAction({
  name: "getFinalSettlement",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: [
    "employees",
    "employee_salary_for_month",
    "payroll_entries",
    "v_employee_vacation_balances",
    "payroll_sac_suggestion",
    "v_payroll_entries_resolved",
  ],
  description:
    "Liquidación final sugerida de un empleado dado de baja: sueldo por los días trabajados del último mes, días y monto de vacaciones no gozadas y SAC proporcional, neto de lo que ya le paga la planilla del SAC del semestre (sac_in_sac_planilla). Es una sugerencia; lo cargado en la planilla puede diferir.",
  input: z.object({
    employeeId: z.string().uuid().describe("employee_id del empleado."),
  }),
  run: async (_ctx, input) => {
    const res = await getFinalSettlementAction(input.employeeId);
    if (!res.ok) return errResult(res.error);
    const d = res.data;
    return okResult(
      `Liquidación final (baja ${d.termination_date}): sueldo ${money(
        d.prorated_salary,
      )} por ${d.days_worked} días · vacaciones ${d.vacation_days} días ${money(
        d.vacation_amount,
      )} · SAC proporcional ${money(d.sac_amount)}${
        d.sac_in_sac_planilla > 0
          ? ` (la planilla del SAC ya le paga ${money(d.sac_in_sac_planilla)})`
          : ""
      }.`,
      d,
      { currency: "ARS" },
    );
  },
});

const EMPLOYEE_ID_INPUT = z.object({
  employeeId: z.string().uuid().describe("employee_id (de searchEmployees)."),
});

export const getEmployeeAccountBalances = defineAiAction({
  name: "getEmployeeAccountBalances",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["v_employee_account_balances", "employees"],
  description:
    "Saldos de la cuenta corriente de los empleados (adelantos, compras a su cargo y deudas menos descuentos de planilla, pagos y condonaciones), por empleado y moneda. Positivo = el empleado debe; balance_socio = la parte que se le debe a un socio. Solo empleados con saldo distinto de cero.",
  input: z.object({}),
  run: async () => {
    const res = await listEmployeeAccountBalancesAction();
    if (!res.ok) return errResult(res.error);
    const owedArs = sumBy(
      res.data.filter((r) => r.currency === "ARS" && r.balance > 0),
      (r) => r.balance,
    );
    return okResult(
      `${res.data.length} saldos de cuenta corriente · deben ${money(owedArs)} en pesos.`,
      { rows: res.data },
      { partial: reachedCap(res.data.length, 500) },
    );
  },
});

export const getEmployeeAccount = defineAiAction({
  name: "getEmployeeAccount",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: [
    "v_employee_account_balances",
    "employee_account_movements",
    "v_employee_debt_plans",
  ],
  description:
    "Cuenta corriente de un empleado: saldo por moneda, planes de devolución (total, cuota mensual, pagado, resta, estado activo/pausado/cancelado/condonado, acreedor empresa o socio) y movimientos (adelanto, cargo, descuento de planilla, pago, condonación). La cuota de un plan activo en pesos es lo que la planilla descuenta por defecto en Deudas.",
  input: EMPLOYEE_ID_INPUT,
  run: async (_ctx, input) => {
    const res = await getEmployeeAccountAction(input.employeeId);
    if (!res.ok) return errResult(res.error);
    const ars = res.data.balances.find((b) => b.currency === "ARS");
    const active = res.data.plans.filter((p) => p.status === "activo").length;
    return okResult(
      `Saldo ${money(ars?.balance ?? 0)} en pesos · ${active} planes activos · ${res.data.movements.length} movimientos.`,
      res.data,
      { partial: res.data.movements_partial },
    );
  },
});

export const getSalaryHistory = defineAiAction({
  name: "getSalaryHistory",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["employee_salary_changes"],
  description:
    "Historial del sueldo base de un empleado: sueldo anterior y nuevo, mes desde el que rige y, si vino de un aumento en %, el porcentaje y el motivo. Lo más reciente primero.",
  input: EMPLOYEE_ID_INPUT,
  run: async (_ctx, input) => {
    const res = await listSalaryChangesAction(input.employeeId);
    if (!res.ok) return errResult(res.error);
    const last = res.data[0];
    return okResult(
      `${res.data.length} cambios de sueldo${
        last?.new_salary != null
          ? ` · último ${money(last.new_salary)} desde ${last.effective_month.slice(0, 7)}`
          : ""
      }.`,
      res.data,
      { partial: reachedCap(res.data.length, 200) },
    );
  },
});

export const getTripExtrasSuggestion = defineAiAction({
  name: "getTripExtrasSuggestion",
  domain: "rrhh",
  permission: "hr:read",
  sideEffect: "read",
  sources: ["payroll_entries", "employees", "drivers", "trips", "shipments"],
  description:
    "Extras sugeridos desde los viajes del mes para la planilla mensual: por chofer, jornadas (días con viaje completado), km y descargas (cargas entregadas) por su tarifa, y cuáles ya se agregaron como extra. Es una sugerencia; lo cargado en la planilla manda.",
  input: z.object({
    year: z.number().describe("Año, ej. 2026."),
    month: z.number().describe("Mes 1-12."),
  }),
  run: async (_ctx, input) => {
    const res = await getPeriodTripExtrasAction(input.year, input.month);
    if (!res.ok) return errResult(res.error);
    const total = sumBy(res.data.rows, (r) => sumBy(r.lines, (l) => l.amount));
    return okResult(
      `${res.data.rows.length} choferes con viajes en ${formatPayrollPeriod(
        input.year,
        input.month,
      )} · extras sugeridos ${money(total)}.`,
      res.data,
      { currency: "ARS", partial: res.data.partial, note: PAYROLL_NOTE },
    );
  },
});
