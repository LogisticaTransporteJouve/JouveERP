import { z } from "zod";

export interface Driver {
  id: string;
  employee_id: string | null;
  user_id: string | null;
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

export const DriverLinkUserSchema = z.object({
  driverId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

// No employee_id: an own driver is created and linked only by HR
// (syncEmployeeDriver), never from the drivers screen.
export const DriverCreateSchema = z.object({
  full_name: z.string().trim().min(1, "Nombre requerido.").max(120),
  cuit: optionalText(20),
  license_number: optionalText(40),
  license_category: optionalText(20),
  phone: optionalText(40),
  notes: optionalText(2000),
});

export type DriverCreateInput = z.infer<typeof DriverCreateSchema>;

// NOTE: user_id is intentionally NOT here. Linking a driver to an app login is
// a security action gated on users:assign_role via linkDriverUserAction — never
// settable through the operations-facing updateDriverAction (drivers:write).
export const DriverUpdateSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(1).max(120).optional(),
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
