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

export const EmployeeCreateSchema = z.object(baseEmployeeFields);

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
