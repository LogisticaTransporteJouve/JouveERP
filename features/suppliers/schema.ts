import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

import {
  IVA_CONDITIONS,
  IVA_CONDITION_LABEL,
  type IvaCondition,
} from "@/features/clients/schema";

export { IVA_CONDITIONS, IVA_CONDITION_LABEL };
export type { IvaCondition };

export const SUPPLIERS_PATH = "/suppliers";

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
      value === null || value === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
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
};

export const SupplierCreateSchema = z.object(baseSupplierFields);

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
});

export const SupplierToggleActiveSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});

export type SupplierCreateInput = z.infer<typeof SupplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof SupplierUpdateSchema>;
export type SupplierToggleActiveInput = z.infer<typeof SupplierToggleActiveSchema>;

// Narrow `iva_condition` to the union enforced by the DB CHECK.
type SupplierRow = Database["public"]["Tables"]["suppliers"]["Row"];
export type Supplier = Omit<SupplierRow, "iva_condition"> & {
  iva_condition: IvaCondition;
};
