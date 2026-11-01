import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import { isValidCuit } from "@/lib/validation/cuit";

import {
  defaultToFiscalSide,
  IVA_CONDITIONS,
  IVA_CONDITION_LABEL,
  type IvaCondition,
} from "@/features/clients/schema";

export { IVA_CONDITIONS, IVA_CONDITION_LABEL };
export type { IvaCondition };

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

const optionalChannelId = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

const optionalCategoryId = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalPaymentTermDays = z
  .union([z.literal(""), z.coerce.number().int().min(1).max(365)])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const baseSupplierFields = {
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
  default_channel_id: optionalChannelId,
  default_payment_term_days: optionalPaymentTermDays,
  category_id: optionalCategoryId,
};

const internalSupplierFields = {
  legal_name: z.string().trim().min(2, "Nombre requerido.").max(120),
  display_name: baseSupplierFields.display_name,
  email: baseSupplierFields.email,
  phone: baseSupplierFields.phone,
  real_address: baseSupplierFields.real_address,
  notes: baseSupplierFields.notes,
  default_channel_id: baseSupplierFields.default_channel_id,
  default_payment_term_days: baseSupplierFields.default_payment_term_days,
  category_id: baseSupplierFields.category_id,
};

// Compras suppliers carry CUIT and IVA condition (AFIP); Otras compras
// suppliers have neither, nor a fiscal address. Unknown keys are dropped.
export const SupplierCreateSchema = z.preprocess(
  defaultToFiscalSide,
  z.discriminatedUnion("is_fiscal", [
    z.object({ ...baseSupplierFields, is_fiscal: z.literal(true) }),
    z.object({ ...internalSupplierFields, is_fiscal: z.literal(false) }),
  ]),
);

export const SupplierUpdateSchema = z.object({
  id: z.string().uuid(),
  cuit: cuit.optional(),
  legal_name: baseSupplierFields.legal_name.optional(),
  display_name: baseSupplierFields.display_name,
  iva_condition: baseSupplierFields.iva_condition.optional(),
  email: baseSupplierFields.email,
  phone: baseSupplierFields.phone,
  address: baseSupplierFields.address,
  real_address: baseSupplierFields.real_address,
  notes: baseSupplierFields.notes,
  default_channel_id: baseSupplierFields.default_channel_id,
  default_payment_term_days: baseSupplierFields.default_payment_term_days,
  category_id: baseSupplierFields.category_id,
});

export const SupplierToggleActiveSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

export type SupplierCreateInput = z.infer<typeof SupplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof SupplierUpdateSchema>;
export type SupplierToggleActiveInput = z.infer<
  typeof SupplierToggleActiveSchema
>;

// Narrow `iva_condition` to the union enforced by the DB CHECK.
type SupplierRow = Database["public"]["Tables"]["suppliers"]["Row"];
export type Supplier = Omit<SupplierRow, "iva_condition"> & {
  iva_condition: IvaCondition | null;
};

/** Join row shape for `suppliers ( legal_name, cuit )` selected from another table. */
export type SupplierIdentityJoin = {
  suppliers: { legal_name: string; cuit: string | null };
};

/** Minimal variant for list queries that only need the supplier's
 *  name (without CUIT). Embedded in another row via a plural join. */
export type SupplierListLegalJoin = {
  suppliers: { legal_name: string } | null;
};

/** Singular variant for `supplier ( legal_name, cuit, iva_condition )` joins
 *  embedded in another object (e.g. payment_orders, PDF render). */
export type SupplierFullJoin = {
  supplier: {
    legal_name: string;
    cuit: string | null;
    iva_condition: string | null;
  } | null;
};
