import { z } from "zod";

import { isoDate } from "@/features/exchange-rates/schema";
import { getAttendanceMonthAction } from "@/features/hr/actions/attendance-actions";
import {
  ATTENDANCE_KIND_LABEL,
  ATTENDANCE_KINDS,
} from "@/features/hr/attendance-schema";
import {
  EMPLOYEE_POSITIONS,
  PAY_FREQUENCIES,
  type Employee,
} from "@/features/hr/schema";
import { createEmployee } from "@/lib/commands/create-employee";
import { updateEmployee } from "@/lib/commands/update-employee";
import { upsertAttendance } from "@/lib/commands/upsert-attendance";

import {
  ATTENDANCE_LABELS,
  attendanceProposalSpec,
  createEmployeeProposalSpec,
  employeeBeforeLabel,
  employeeFieldText,
  updateEmployeeProposalSpec,
  type ProposalLabels,
} from "../../lib/proposal-specs";
import { defineAiProposal } from "../propose";

import { resolveEmployee } from "./hr-refs";

// RRHH proposals over the forms' writes. `prepare` resolves the employee
// through searchEmployeesAction (hr:read + RLS) and drafts what the form
// would send; the write runs only after the user accepts, through the
// lib/commands function the form's server action calls. Every one needs
// hr:write, which operations, warehouse and driver do not have: salaries
// stay out of their assistant.

const money = z.number().finite().min(0).max(999_999_999.99);
const text = (max: number) => z.string().trim().max(max);

/** What the employee form takes, as the model fills it in. */
const employeeFields = {
  position: z
    .enum(EMPLOYEE_POSITIONS)
    .describe("Puesto; 'Chofer / Acompañante' también lo da de alta en Flota."),
  cuil: text(13).describe("CUIL, 11 dígitos (con o sin guiones)."),
  cbu: text(26).describe("CBU, 22 dígitos."),
  pay_frequency: z.enum(PAY_FREQUENCIES),
  base_salary: money.describe("Sueldo base mensual neto, en pesos."),
  viatico_monthly: money.describe("Viático mensual fijo, en pesos."),
  is_monotributo: z.boolean(),
  hire_date: isoDate,
  notes: text(2000),
  convenio: text(120),
  categoria: text(120),
  obra_social: text(120),
  art: text(120),
  retribucion_formal: money.describe(
    "Retribución del recibo formal (liquidador), en pesos.",
  ),
  license_number: text(40).describe("Solo choferes: número de licencia."),
  license_category: text(20).describe("Solo choferes: categoría de licencia."),
  driver_phone: text(40).describe("Solo choferes: teléfono."),
};

/** The model's fields that were given, without the undefined ones. */
function given(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
}

/** Every employee field optional: an edit sends only what changes. */
const EmployeeFieldsInput = z.object(employeeFields).partial();

export const proposeCreateEmployee = defineAiProposal({
  name: "proposeCreateEmployee",
  domain: "rrhh",
  // The form's gate (hr:write) plus the read that checks the CUIL is new.
  permission: ["hr:write", "hr:read"],
  sources: ["employees", "drivers"],
  description:
    "Propose registering a new employee (alta de empleado) for the user to " +
    "accept on a card, with the fields of the employee form: name, position, " +
    "CUIL, CBU, pay frequency, base salary, monthly viático, hire date… " +
    "Writes nothing by itself. Never invent a salary or a CUIL the user did " +
    "not say.",
  input: EmployeeFieldsInput.extend({
    legal_name: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe("Apellido y nombre."),
    hire_date: isoDate.describe("Fecha de ingreso, YYYY-MM-DD."),
  }),
  spec: createEmployeeProposalSpec,
  prepare: async (_ctx, input) => {
    const cuil = input.cuil?.replace(/[^0-9]/g, "");
    if (cuil && cuil.length === 11) {
      const same = await resolveEmployee(cuil, { onlyActive: false });
      if (same.ok && same.value.cuil === cuil) {
        return {
          kind: "issues",
          issues: [
            {
              field: "cuil",
              message: `Ya hay un empleado con el CUIL ${cuil}: ${same.value.legal_name}.`,
            },
          ],
        };
      }
    }
    return {
      kind: "draft",
      draft: {
        ...given(input),
        pay_frequency: input.pay_frequency ?? "mensual",
        viatico_monthly: input.viatico_monthly ?? 0,
        is_monotributo: input.is_monotributo ?? false,
      },
    };
  },
  execute: (ctx, draft) => createEmployee(ctx, draft),
});

/** The form's editable columns of an employee, as the edit draft starts. */
function currentEmployeeFields(e: Employee) {
  return {
    legal_name: e.legal_name,
    position: e.position,
    cuil: e.cuil,
    cbu: e.cbu,
    pay_frequency: e.pay_frequency,
    base_salary: e.base_salary === null ? null : Number(e.base_salary),
    viatico_monthly: Number(e.viatico_monthly),
    is_monotributo: e.is_monotributo,
    hire_date: e.hire_date,
    notes: e.notes,
    convenio: e.convenio,
    categoria: e.categoria,
    obra_social: e.obra_social,
    art: e.art,
    retribucion_formal:
      e.retribucion_formal === null ? null : Number(e.retribucion_formal),
  };
}

export const proposeUpdateEmployee = defineAiProposal({
  name: "proposeUpdateEmployee",
  domain: "rrhh",
  permission: ["hr:write", "hr:read"],
  sources: ["employees", "drivers"],
  description:
    "Propose editing an employee's data (sueldo base, puesto, CBU, CUIL, " +
    "frecuencia, viático, datos del recibo formal, licencia de chofer…) for " +
    "the user to accept on a card that shows each change as before → after. " +
    "Pass only the fields that change. Writes nothing by itself. To register " +
    "a salary raise with its date, the Sueldos card of the employee is the " +
    "place; this edits the current base salary.",
  input: EmployeeFieldsInput.extend({
    employee: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Employee name or CUIL, as the user said it."),
    legal_name: z.string().trim().min(2).max(120).optional(),
  }),
  spec: updateEmployeeProposalSpec,
  prepare: async (_ctx, input) => {
    const { employee: said, ...changes } = input;
    const found = await resolveEmployee(said, { onlyActive: false });
    if (!found.ok) return found.result;
    const e = found.value;
    const current = currentEmployeeFields(e);
    const draft = { id: e.id, ...current, ...given(changes) };
    const labels: ProposalLabels = { [e.id]: e.legal_name };
    for (const [key, value] of Object.entries(current)) {
      labels[employeeBeforeLabel(key)] = employeeFieldText(key, value);
    }
    const unchanged = Object.entries(given(changes)).every(
      ([key, value]) =>
        employeeFieldText(key, value) ===
        (labels[employeeBeforeLabel(key)] ?? "—"),
    );
    if (unchanged) {
      return {
        kind: "issues",
        issues: [
          {
            field: "employee",
            message: `No hay cambios para ${e.legal_name}: decime qué dato cambia.`,
          },
        ],
      };
    }
    return { kind: "draft", draft, labels };
  },
  execute: async (ctx, draft) => {
    const res = await updateEmployee(ctx.userId, draft);
    return res.ok ? { ok: true, data: { id: draft.id } } : res;
  },
});

const SYNCED_SOURCE: Record<string, string> = {
  leave_sync: "una licencia",
  holiday_sync: "un feriado",
};

export const proposeAttendance = defineAiProposal({
  name: "proposeAttendance",
  domain: "rrhh",
  permission: ["hr:write", "hr:read"],
  sources: ["attendance_records", "employees"],
  description:
    "Propose loading one employee's attendance for a day by hand (ausente " +
    "justificado o no, tarde, salida temprana, enfermedad, licencia, " +
    "feriado) for the user to accept on a card. It replaces what that day " +
    "had loaded by hand; a day that comes from a leave or a holiday is " +
    "changed from its source, not here. For a leave of several days use " +
    "proposeLeave. Writes nothing by itself.",
  input: z.object({
    employee: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Employee name or CUIL, as the user said it."),
    date: isoDate,
    kind: z.enum(ATTENDANCE_KINDS),
    hours_lost: z
      .number()
      .positive()
      .max(24)
      .optional()
      .describe("Late or early leave: hours lost."),
    notes: z.string().trim().max(500).optional(),
  }),
  spec: attendanceProposalSpec,
  prepare: async (_ctx, input) => {
    const found = await resolveEmployee(input.employee);
    if (!found.ok) return found.result;
    const e = found.value;
    const month = await getAttendanceMonthAction(
      Number(input.date.slice(0, 4)),
      Number(input.date.slice(5, 7)),
    );
    if (!month.ok) return { kind: "error", error: month.error };
    const current = month.data.records.find(
      (r) => r.employee_id === e.id && r.date === input.date,
    );
    const synced = current ? SYNCED_SOURCE[current.source] : undefined;
    if (current && synced) {
      return {
        kind: "issues",
        issues: [
          {
            field: "date",
            message: `Ese día de ${e.legal_name} lo carga ${synced} (${ATTENDANCE_KIND_LABEL[current.kind]}): se cambia desde ${synced}, no desde Asistencia.`,
          },
        ],
      };
    }
    const labels: ProposalLabels = { [e.id]: e.legal_name };
    if (current) {
      labels[ATTENDANCE_LABELS.before] = ATTENDANCE_KIND_LABEL[current.kind];
    }
    return {
      kind: "draft",
      draft: {
        employee_id: e.id,
        date: input.date,
        kind: input.kind,
        hours_lost: input.hours_lost ?? null,
        notes: input.notes ?? null,
      },
      labels,
    };
  },
  execute: (ctx, draft) => upsertAttendance(ctx.userId, draft),
});
