import { z } from "zod";

import type { Database } from "@/lib/db/database.types";

export const PALLET_STATUSES = ["en_deposito", "despachado"] as const;
export type PalletStatus = (typeof PALLET_STATUSES)[number];

export const PALLET_STATUS_LABELS: Record<PalletStatus, string> = {
  en_deposito: "En depósito",
  despachado: "Despachado",
};

export function isPalletStatus(v: unknown): v is PalletStatus {
  return (
    typeof v === "string" && (PALLET_STATUSES as readonly string[]).includes(v)
  );
}

export interface Pallet {
  id: string;
  warehouse_id: string;
  client_id: string;
  product_id: string | null;
  code: string;
  quantity: number | null;
  status: PalletStatus;
  entry_date: string;
  exit_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  warehouse: { name: string } | null;
  client: { legal_name: string } | null;
  product: { name: string } | null;
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

export const PalletCreateSchema = z.object({
  warehouse_id: z.string().uuid("Depósito requerido."),
  client_id: z.string().uuid("Cliente requerido."),
  product_id: optionalUuid,
  code: z.string().trim().min(1, "Código requerido.").max(60),
  quantity: optionalAmount,
  status: z.enum(PALLET_STATUSES).default("en_deposito"),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  exit_date: optionalDate,
  notes: optionalText(2000),
});

export type PalletCreateInput = z.infer<typeof PalletCreateSchema>;

/**
 * Bulk pallet entry: shared fields + a count. Codes are generated server-side
 * as `<prefix>-<seq>` continuing the existing sequence (fast "todo de una").
 */
export const PalletBulkCreateSchema = z.object({
  warehouse_id: z.string().uuid("Depósito requerido."),
  client_id: z.string().uuid("Cliente requerido."),
  product_id: optionalUuid,
  quantity: optionalAmount,
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  notes: optionalText(2000),
  count: z.coerce
    .number()
    .int("Ingresá una cantidad entera.")
    .min(1, "Cantidad mínima 1.")
    .max(500, "Máximo 500 pallets por carga."),
  code_prefix: z
    .string()
    .trim()
    .min(1, "Prefijo requerido.")
    .max(40, "Prefijo demasiado largo.")
    .regex(/^[A-Za-z0-9-]+$/, "Prefijo solo con letras, números o guion.")
    .default("PAL"),
});
export type PalletBulkCreateInput = z.infer<typeof PalletBulkCreateSchema>;

/** Bulk OUT (despacho): mark the selected pallets as despachado on a date. */
export const PalletBulkDispatchSchema = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1, "Seleccioná al menos un pallet.")
    .max(500, "Máximo 500 pallets por despacho."),
  exit_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de salida requerida."),
});
export type PalletBulkDispatchInput = z.infer<typeof PalletBulkDispatchSchema>;

export const PalletUpdateSchema = z.object({
  id: z.string().uuid(),
  warehouse_id: z.string().uuid("Depósito requerido.").optional(),
  client_id: z.string().uuid("Cliente requerido.").optional(),
  product_id: optionalUuid,
  code: z.string().trim().min(1, "Código requerido.").max(60).optional(),
  quantity: optionalAmount,
  status: z.enum(PALLET_STATUSES).optional(),
  entry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida.")
    .optional(),
  exit_date: optionalDate,
  notes: optionalText(2000),
});

export type PalletsSummaryRow =
  Database["public"]["Functions"]["ai_pallets_summary"]["Returns"][number];
