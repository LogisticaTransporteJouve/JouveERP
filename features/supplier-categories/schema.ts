import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

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

export const SupplierCategoryCreateSchema = z
  .object({
    name: z.string().trim().min(2, "Nombre requerido.").max(60),
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
  name: z.string().trim().min(2).max(60).optional(),
  slug: slugTransform.optional(),
  is_active: z.boolean().optional(),
});

export const SupplierCategoryDeleteSchema = z.object({
  id: z.string().uuid(),
});

export type SupplierCategoryCreateInput = z.infer<
  typeof SupplierCategoryCreateSchema
>;
export type SupplierCategoryUpdateInput = z.infer<
  typeof SupplierCategoryUpdateSchema
>;
export type SupplierCategory =
  Database["public"]["Tables"]["supplier_categories"]["Row"];

export { slugFromName };
