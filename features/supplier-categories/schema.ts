import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

const slugTransform = z
  .string()
  .trim()
  .min(2, "Slug requerido.")
  .max(40)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Solo letras minúsculas, números y _. Debe empezar con letra.",
  );

const slugFromName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]/, "x");

/** A category name: its slug is derived from it, so it needs a letter or digit. */
export const SupplierCategoryNameSchema = z
  .string()
  .trim()
  .min(1, "Ingresá un nombre.")
  .max(60, "Máximo 60 caracteres.")
  .refine((name) => slugFromName(name).length > 0, {
    message: "El nombre necesita al menos una letra o un número.",
  });

export const SupplierCategoryCreateSchema = z
  .object({
    name: SupplierCategoryNameSchema,
    slug: z
      .string()
      .trim()
      .transform((v) => (v.length === 0 ? "" : v))
      .optional(),
    is_active: z.boolean().default(true),
  })
  .transform((data) => ({
    ...data,
    slug:
      data.slug && data.slug.length > 0
        ? slugTransform.parse(data.slug)
        : slugFromName(data.name),
  }));

export const SupplierCategoryUpdateSchema = z.object({
  id: z.string().uuid(),
  name: SupplierCategoryNameSchema.optional(),
  slug: slugTransform.optional(),
  is_active: z.boolean().optional(),
});

export const SupplierCategoryDeleteSchema = z.object({
  id: z.string().uuid(),
});

export const SupplierCategoryPurchasesInputSchema = z
  .object({
    categoryId: UuidSchema,
    from: IsoDateSchema,
    to: IsoDateSchema,
    /** Channel side: true fiscal, false internal, null both. */
    isFiscal: z.boolean().nullable(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .refine(
    (v) => v.from <= v.to,
    "La fecha desde es posterior a la fecha hasta.",
  );

export type SupplierCategoryCreateInput = z.infer<
  typeof SupplierCategoryCreateSchema
>;
export type SupplierCategoryUpdateInput = z.infer<
  typeof SupplierCategoryUpdateSchema
>;
export type SupplierCategory =
  Database["public"]["Tables"]["supplier_categories"]["Row"];

export { slugFromName };
