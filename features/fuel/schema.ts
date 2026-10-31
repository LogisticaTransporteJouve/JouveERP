import { z } from "zod";

import { CostVoucherShape } from "@/lib/cost-vouchers";

export interface FuelLoad {
  id: string;
  vehicle_id: string;
  trip_id: string | null;
  load_date: string;
  liters: number;
  amount: number;
  odometer_km: number | null;
  station: string | null;
  card: string | null;
  notes: string | null;
  purchase_invoice_id: string | null;
  transaction_id: string | null;
  created_at: string;
  vehicle: { patente: string } | null;
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

const optionalAmount = z
  .union([z.literal(""), z.coerce.number().min(0)])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const FuelLoadCreateSchema = z.object({
  vehicle_id: z.string().uuid("Vehículo requerido."),
  trip_id: optionalUuid,
  load_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  liters: z.coerce.number().gt(0, "Litros debe ser mayor a 0."),
  amount: z.coerce.number().min(0, "Importe inválido."),
  odometer_km: optionalAmount,
  station: optionalText(120),
  card: optionalText(120),
  notes: optionalText(2000),
  ...CostVoucherShape,
});

export type FuelLoadCreateInput = z.infer<typeof FuelLoadCreateSchema>;

export const FuelLoadUpdateSchema = z.object({
  id: z.string().uuid(),
  vehicle_id: z.string().uuid("Vehículo requerido.").optional(),
  trip_id: optionalUuid,
  load_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida.")
    .optional(),
  liters: z.coerce.number().gt(0, "Litros debe ser mayor a 0.").optional(),
  amount: z.coerce.number().min(0, "Importe inválido.").optional(),
  odometer_km: optionalAmount,
  station: optionalText(120),
  card: optionalText(120),
  notes: optionalText(2000),
  ...CostVoucherShape,
});
