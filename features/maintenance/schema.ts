import { z } from "zod";

import { CostVoucherShape } from "@/lib/cost-vouchers";

export const MAINTENANCE_KINDS = [
  "service",
  "reparacion",
  "neumaticos",
  "vtv",
  "otro",
] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  service: "Service",
  reparacion: "Reparación",
  neumaticos: "Neumáticos",
  vtv: "VTV",
  otro: "Otro",
};

export function isMaintenanceKind(v: unknown): v is MaintenanceKind {
  return (
    typeof v === "string" &&
    (MAINTENANCE_KINDS as readonly string[]).includes(v)
  );
}

export interface MaintenanceRecord {
  id: string;
  vehicle_id: string;
  service_date: string;
  kind: MaintenanceKind;
  description: string;
  cost: number | null;
  odometer_km: number | null;
  next_service_date: string | null;
  next_service_km: number | null;
  provider: string | null;
  notes: string | null;
  purchase_invoice_id: string | null;
  transaction_id: string | null;
  created_at: string;
  vehicle: { patente: string } | null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const optionalDate = z
  .union([
    z.literal(""),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  ])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalAmount = z
  .union([z.literal(""), z.coerce.number().min(0)])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const MaintenanceCreateSchema = z.object({
  vehicle_id: z.string().uuid("Vehículo requerido."),
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  kind: z.enum(MAINTENANCE_KINDS).default("service"),
  description: z.string().trim().min(1, "Descripción requerida.").max(500),
  cost: optionalAmount,
  odometer_km: optionalAmount,
  next_service_date: optionalDate,
  next_service_km: optionalAmount,
  provider: optionalText(160),
  notes: optionalText(2000),
  ...CostVoucherShape,
});

export type MaintenanceCreateInput = z.infer<typeof MaintenanceCreateSchema>;

export const MaintenanceUpdateSchema = z.object({
  id: z.string().uuid(),
  vehicle_id: z.string().uuid("Vehículo requerido.").optional(),
  service_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida.")
    .optional(),
  kind: z.enum(MAINTENANCE_KINDS).optional(),
  description: z
    .string()
    .trim()
    .min(1, "Descripción requerida.")
    .max(500)
    .optional(),
  cost: optionalAmount,
  odometer_km: optionalAmount,
  next_service_date: optionalDate,
  next_service_km: optionalAmount,
  provider: optionalText(160),
  notes: optionalText(2000),
  ...CostVoucherShape,
});
