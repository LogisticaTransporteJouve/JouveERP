import { z } from "zod";

export interface Product {
  id: string;
  client_id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  client: { legal_name: string } | null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const ProductCreateSchema = z.object({
  client_id: z.string().uuid("Cliente requerido."),
  name: z.string().trim().min(1, "Nombre requerido.").max(160),
  sku: optionalText(80),
  unit: optionalText(40),
  notes: optionalText(2000),
});

export type ProductCreateInput = z.infer<typeof ProductCreateSchema>;

export const ProductUpdateSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid("Cliente requerido.").optional(),
  name: z.string().trim().min(1, "Nombre requerido.").max(160).optional(),
  sku: optionalText(80),
  unit: optionalText(40),
  is_active: z.boolean().optional(),
  notes: optionalText(2000),
});

export const ProductToggleSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});
