import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const SupplierCategoryNameSchema = z
  .string()
  .trim()
  .min(1, "Ingresá un nombre.")
  .max(60, "Máximo 60 caracteres.");

export const SupplierCategoryCreateSchema = z.object({
  name: SupplierCategoryNameSchema,
  is_active: z.boolean().default(true),
});

export const SupplierCategoryUpdateSchema = z.object({
  id: z.string().uuid(),
  name: SupplierCategoryNameSchema.optional(),
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
export type SupplierCategory = Pick<
  Database["public"]["Tables"]["supplier_categories"]["Row"],
  "id" | "name" | "is_active" | "created_at" | "updated_at"
>;
