import { z } from "zod";

export interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  capacity_pallets: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const optionalCapacity = z
  .union([z.literal(""), z.coerce.number().int().min(0)])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const WarehouseCreateSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido.").max(120),
  address: optionalText(200),
  capacity_pallets: optionalCapacity,
  notes: optionalText(2000),
});

export type WarehouseCreateInput = z.infer<typeof WarehouseCreateSchema>;

export const WarehouseUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  address: optionalText(200),
  capacity_pallets: optionalCapacity,
  is_active: z.boolean().optional(),
  notes: optionalText(2000),
});

export const WarehouseToggleSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});
