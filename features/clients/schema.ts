import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const IVA_CONDITIONS = [
  "responsable_inscripto",
  "monotributo",
  "exento",
  "consumidor_final",
  "no_categorizado",
] as const;

export type IvaCondition = (typeof IVA_CONDITIONS)[number];

export const IVA_CONDITION_LABEL: Record<IvaCondition, string> = {
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributo",
  exento: "Exento",
  consumidor_final: "Consumidor Final",
  no_categorizado: "No Categorizado",
};

export const CLIENTS_PATH = "/clientes";

const trimmedNullable = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

const emailNullable = z
  .string()
  .trim()
  .max(254)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional()
  .refine(
    (value) => value === null || value === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    { message: "Email inválido." },
  );

const phoneNullable = z
  .string()
  .trim()
  .max(50)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

const cuit = z.preprocess(
  (value) => (typeof value === "string" ? value.replace(/[^0-9]/g, "") : value),
  z.string().regex(/^[0-9]{11}$/, "El CUIT debe tener 11 dígitos."),
);

const baseClientFields = {
  cuit,
  legal_name: z.string().trim().min(2, "Razón social requerida.").max(120),
  display_name: z
    .string()
    .trim()
    .max(120)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional(),
  iva_condition: z.enum(IVA_CONDITIONS),
  email: emailNullable,
  phone: phoneNullable,
  address: trimmedNullable,
  notes: trimmedNullable,
};

export const ClientCreateSchema = z.object(baseClientFields);

export const ClientUpdateSchema = z
  .object({
    id: z.string().uuid(),
    cuit: cuit.optional(),
    legal_name: baseClientFields.legal_name.optional(),
    display_name: baseClientFields.display_name,
    iva_condition: baseClientFields.iva_condition.optional(),
    email: baseClientFields.email,
    phone: baseClientFields.phone,
    address: baseClientFields.address,
    notes: baseClientFields.notes,
  });

export const ClientToggleActiveSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

export type ClientCreateInput = z.infer<typeof ClientCreateSchema>;
export type ClientUpdateInput = z.infer<typeof ClientUpdateSchema>;
export type ClientToggleActiveInput = z.infer<typeof ClientToggleActiveSchema>;

export function isIvaCondition(value: unknown): value is IvaCondition {
  return (
    typeof value === "string" &&
    (IVA_CONDITIONS as readonly string[]).includes(value)
  );
}

// Narrow `iva_condition` to the union enforced by the DB CHECK — Supabase's
// generated types report it as `string`.
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
export type Client = Omit<ClientRow, "iva_condition"> & {
  iva_condition: IvaCondition;
};
