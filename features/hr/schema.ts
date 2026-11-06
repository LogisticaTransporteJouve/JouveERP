import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

// ─── Constants ───────────────────────────────────────────────────────────────

export const EMPLOYEES_PAGE_SIZE = 50;

export const PAY_FREQUENCIES = ["semanal", "mensual", "mixto"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

export const PAY_FREQUENCY_LABEL: Record<PayFrequency, string> = {
  semanal: "Semanal",
  mensual: "Mensual",
  mixto: "Mixto",
};

// ─── Field helpers ───────────────────────────────────────────────────────────

const trimmedNullable = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

const shortTextNullable = z
  .string()
  .trim()
  .max(120)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

// CUIL: 11 digits, optional. Accepts input with dashes/spaces and strips them.
const cuilNullable = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const stripped = value.replace(/[^0-9]/g, "");
    return stripped.length === 0 ? null : stripped;
  },
  z
    .string()
    .regex(/^[0-9]{11}$/, "El CUIL debe tener 11 dígitos.")
    .nullable()
    .optional(),
);

// CBU: exactly 22 digits, optional. Check-digit validation goes in
// another layer when the case comes up (for now the correct shape is enough).
const cbuNullable = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const stripped = value.replace(/[^0-9]/g, "");
    return stripped.length === 0 ? null : stripped;
  },
  z
    .string()
    .regex(/^[0-9]{22}$/, "El CBU debe tener 22 dígitos.")
    .nullable()
    .optional(),
);

const baseSalaryNullable = z
  .union([z.literal(""), z.coerce.number().min(0).max(999999999.99)])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const viaticoRequired = z.coerce
  .number()
  .min(0, "El viático no puede ser negativo.")
  .max(999999999.99);

const hireDateRequired = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de ingreso requerida.");

// ─── Schemas ─────────────────────────────────────────────────────────────────

// ─── Position ────────────────────────────────────────────────────────────────

/** Positions offered in the employee form. A driver also works as companion,
 *  so both are one option. Rows saved before the list keep their free text. */
export const EMPLOYEE_POSITIONS = [
  "Chofer / Acompañante",
  "Administrativo",
  "Mecánico",
  "Depósito",
  "Socio / Dirección",
  "Otro",
] as const;

export const DRIVER_POSITION = "Chofer / Acompañante";

/** Whether this position drives: the employee gets a driver record (Flota). */
export function isDriverPosition(position: string | null | undefined): boolean {
  return position === DRIVER_POSITION;
}

const driverText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

/** Driver data kept on the employee's driver record (Flota → Choferes). */
const driverFields = {
  license_number: driverText(40),
  license_category: driverText(20),
  driver_phone: driverText(40),
};

/** The driver fields a form sent, as the driver record's columns; an absent
 *  key keeps the stored value. */
export function driverRecordPatch(fields: {
  license_number?: string | null;
  license_category?: string | null;
  driver_phone?: string | null;
}): {
  license_number?: string | null;
  license_category?: string | null;
  phone?: string | null;
} {
  return {
    ...(fields.license_number !== undefined && {
      license_number: fields.license_number,
    }),
    ...(fields.license_category !== undefined && {
      license_category: fields.license_category,
    }),
    ...(fields.driver_phone !== undefined && { phone: fields.driver_phone }),
  };
}

/** Data of the formal receipt the liquidador issues (decision D5). */
const formalFields = {
  convenio: shortTextNullable,
  categoria: shortTextNullable,
  obra_social: shortTextNullable,
  art: shortTextNullable,
  retribucion_formal: baseSalaryNullable,
};

const baseEmployeeFields = {
  legal_name: z.string().trim().min(2, "Apellido y nombre requerido.").max(120),
  position: shortTextNullable,
  cuil: cuilNullable,
  cbu: cbuNullable,
  pay_frequency: z.enum(PAY_FREQUENCIES),
  base_salary: baseSalaryNullable,
  viatico_monthly: viaticoRequired,
  is_monotributo: z.coerce.boolean(),
  hire_date: hireDateRequired,
  notes: trimmedNullable,
};

const optionalVacationDays = z.coerce
  .number()
  .int("Tiene que ser un número entero de días.")
  .min(0, "No puede ser negativo.")
  .max(365, "Demasiados días.")
  .nullable()
  .optional();

export const EmployeeCreateSchema = z.object({
  ...baseEmployeeFields,
  ...driverFields,
  ...formalFields,
  /** Days of the vacation period in course; empty = leave it to the 1/10 job. */
  vacation_current_days: optionalVacationDays,
  /** Days still pending from earlier years, as one figure. */
  vacation_previous_days: optionalVacationDays,
});

export const EmployeeUpdateSchema = z.object({
  id: z.string().uuid(),
  legal_name: baseEmployeeFields.legal_name.optional(),
  position: baseEmployeeFields.position,
  cuil: baseEmployeeFields.cuil,
  cbu: baseEmployeeFields.cbu,
  pay_frequency: baseEmployeeFields.pay_frequency.optional(),
  base_salary: baseEmployeeFields.base_salary,
  viatico_monthly: baseEmployeeFields.viatico_monthly.optional(),
  is_monotributo: baseEmployeeFields.is_monotributo.optional(),
  hire_date: baseEmployeeFields.hire_date.optional(),
  notes: baseEmployeeFields.notes,
  ...driverFields,
  ...formalFields,
});

export const EmployeeTerminateSchema = z
  .object({
    id: z.string().uuid(),
    termination_date: hireDateRequired,
    notes: trimmedNullable,
  })
  .strict();

export const EmployeeReactivateSchema = z.object({
  id: z.string().uuid(),
});

export type EmployeeCreateInput = z.infer<typeof EmployeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof EmployeeUpdateSchema>;
export type EmployeeTerminateInput = z.infer<typeof EmployeeTerminateSchema>;
export type EmployeeReactivateInput = z.infer<typeof EmployeeReactivateSchema>;

// Narrow `pay_frequency` to the union enforced by the DB CHECK.
type EmployeeRow = Database["public"]["Tables"]["employees"]["Row"];
export type Employee = Omit<EmployeeRow, "pay_frequency"> & {
  pay_frequency: PayFrequency;
};

export function isPayFrequency(value: unknown): value is PayFrequency {
  return (
    typeof value === "string" &&
    (PAY_FREQUENCIES as readonly string[]).includes(value)
  );
}
