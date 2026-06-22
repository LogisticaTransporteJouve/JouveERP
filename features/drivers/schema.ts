import { z } from "zod";

export interface Driver {
  id: string;
  employee_id: string | null;
  full_name: string;
  cuit: string | null;
  license_number: string | null;
  license_category: string | null;
  phone: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const optionalUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const DriverCreateSchema = z.object({
  full_name: z.string().trim().min(1, "Nombre requerido.").max(120),
  employee_id: optionalUuid,
  cuit: optionalText(20),
  license_number: optionalText(40),
  license_category: optionalText(20),
  phone: optionalText(40),
  notes: optionalText(2000),
});

export type DriverCreateInput = z.infer<typeof DriverCreateSchema>;

export const DriverUpdateSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(1).max(120).optional(),
  employee_id: optionalUuid,
  cuit: optionalText(20),
  license_number: optionalText(40),
  license_category: optionalText(20),
  phone: optionalText(40),
  is_active: z.boolean().optional(),
  notes: optionalText(2000),
});

export const DriverToggleSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});
