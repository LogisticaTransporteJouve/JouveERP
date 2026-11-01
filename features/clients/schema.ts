import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import { isValidCuit } from "@/lib/validation/cuit";

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

/** The IVA condition's label, or `null` for an internal counterparty (none). */
export function ivaConditionLabel(value: string | null): string | null {
  return isIvaCondition(value) ? IVA_CONDITION_LABEL[value] : null;
}

/** "CUIT 30714637432 · Responsable Inscripto" for a fiscal client or
 *  supplier; an internal one has neither. */
export function counterpartyIdentityLabel(party: {
  cuit: string | null;
  iva_condition: string | null;
}): string {
  if (!party.cuit) return "Sin CUIT · interno";
  const iva = ivaConditionLabel(party.iva_condition);
  return iva ? `CUIT ${party.cuit} · ${iva}` : `CUIT ${party.cuit}`;
}

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
    (value) =>
      value === null ||
      value === undefined ||
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
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
  z
    .string()
    .regex(/^[0-9]{11}$/, "El CUIT debe tener 11 dígitos.")
    .refine(isValidCuit, "CUIT inválido (dígito verificador incorrecto)."),
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
  real_address: trimmedNullable,
  notes: trimmedNullable,
};

/** A caller that does not say the side creates a fiscal (Ventas) record. */
export function defaultToFiscalSide(value: unknown): unknown {
  return typeof value === "object" && value !== null && !("is_fiscal" in value)
    ? { ...value, is_fiscal: true }
    : value;
}

const internalClientFields = {
  legal_name: z.string().trim().min(2, "Nombre requerido.").max(120),
  display_name: baseClientFields.display_name,
  email: baseClientFields.email,
  phone: baseClientFields.phone,
  real_address: baseClientFields.real_address,
  notes: baseClientFields.notes,
};

// Ventas clients carry CUIT and IVA condition (AFIP); Otras ventas clients
// have neither, nor a fiscal address. Unknown keys are dropped.
export const ClientCreateSchema = z.preprocess(
  defaultToFiscalSide,
  z.discriminatedUnion("is_fiscal", [
    z.object({ ...baseClientFields, is_fiscal: z.literal(true) }),
    z.object({ ...internalClientFields, is_fiscal: z.literal(false) }),
  ]),
);

export const ClientUpdateSchema = z.object({
  id: z.string().uuid(),
  cuit: cuit.optional(),
  legal_name: baseClientFields.legal_name.optional(),
  display_name: baseClientFields.display_name,
  iva_condition: baseClientFields.iva_condition.optional(),
  email: baseClientFields.email,
  phone: baseClientFields.phone,
  address: baseClientFields.address,
  real_address: baseClientFields.real_address,
  notes: baseClientFields.notes,
});

export const ClientToggleActiveSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

export const VerifyCuitSchema = z.object({
  cuit: z.preprocess(
    (value) =>
      typeof value === "string" ? value.replace(/[-\s]/g, "") : value,
    z
      .string()
      .regex(
        /^[23]\d{10}$/,
        "CUIT inválido — debe tener 11 dígitos y empezar con 2 o 3.",
      ),
  ),
});

export type VerifyCuitInput = z.infer<typeof VerifyCuitSchema>;

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
// generated types report it as `string`. An internal client (Otras ventas,
// `is_fiscal = false`) has neither CUIT nor IVA condition.
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
export type Client = Omit<ClientRow, "iva_condition"> & {
  iva_condition: IvaCondition | null;
};

/** Join row shape for `client ( legal_name )` or `client ( legal_name, email )`
 *  embedded in another table. Used in send-email, PDFs and detail rows. */
export type ClientLegalJoin = {
  client: { legal_name: string; email?: string | null } | null;
};

/** Plural variant for list queries that return `clients ( legal_name )`
 *  as a join embedded in the parent row. */
export type ClientsListLegalJoin = {
  clients: { legal_name: string } | null;
};

/** Extended variant with CUIT + iva_condition (used by fiscal PDFs). */
export type ClientIdentityJoin = {
  client: {
    legal_name: string;
    cuit: string | null;
    iva_condition: string | null;
  } | null;
};
