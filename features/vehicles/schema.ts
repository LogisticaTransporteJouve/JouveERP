import { z } from "zod";

export const VEHICLE_TYPES = [
  "camion",
  "acoplado",
  "semi",
  "utilitario",
  "furgon",
  "auto",
  "otro",
] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  camion: "Camión",
  acoplado: "Acoplado",
  semi: "Semi",
  utilitario: "Utilitario",
  furgon: "Furgón",
  auto: "Auto",
  otro: "Otro",
};

export function isVehicleType(value: unknown): value is VehicleType {
  return (
    typeof value === "string" &&
    (VEHICLE_TYPES as readonly string[]).includes(value)
  );
}

export interface Vehicle {
  id: string;
  patente: string;
  alias: string | null;
  vehicle_type: VehicleType;
  brand: string | null;
  model: string | null;
  year: number | null;
  fleet: string | null;
  capacity_kg: number | null;
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

const optionalYear = z
  .union([z.literal(""), z.coerce.number().int().min(1950).max(2100)])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalCapacity = z
  .union([z.literal(""), z.coerce.number().min(0)])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const VehicleCreateSchema = z.object({
  patente: z.string().trim().min(1, "Patente requerida.").max(20),
  vehicle_type: z.enum(VEHICLE_TYPES),
  alias: optionalText(120),
  brand: optionalText(60),
  model: optionalText(60),
  year: optionalYear,
  fleet: optionalText(60),
  capacity_kg: optionalCapacity,
  notes: optionalText(2000),
});

export type VehicleCreateInput = z.infer<typeof VehicleCreateSchema>;

export const VehicleUpdateSchema = z.object({
  id: z.string().uuid(),
  patente: z.string().trim().min(1).max(20).optional(),
  vehicle_type: z.enum(VEHICLE_TYPES).optional(),
  alias: optionalText(120),
  brand: optionalText(60),
  model: optionalText(60),
  year: optionalYear,
  fleet: optionalText(60),
  capacity_kg: optionalCapacity,
  is_active: z.boolean().optional(),
  notes: optionalText(2000),
});

export const VehicleToggleSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});
