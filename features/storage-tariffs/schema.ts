import { z } from "zod";

export const TARIFF_PERIODS = ["daily", "monthly"] as const;
export type TariffPeriod = (typeof TARIFF_PERIODS)[number];

export const TARIFF_PERIOD_LABELS: Record<TariffPeriod, string> = {
  daily: "Diario",
  monthly: "Mensual",
};

export function isTariffPeriod(v: unknown): v is TariffPeriod {
  return typeof v === "string" && (TARIFF_PERIODS as readonly string[]).includes(v);
}

export interface StorageTariff {
  id: string;
  client_id: string | null;
  rate_per_pallet: number;
  period: TariffPeriod;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  client: { legal_name: string } | null;
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).");

const optionalDate = z
  .union([z.literal(""), dateStr])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalNotes = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

export const StorageTariffCreateSchema = z
  .object({
    client_id: optionalUuid,
    rate_per_pallet: z.coerce
      .number()
      .positive("La tarifa debe ser mayor a 0."),
    period: z.enum(TARIFF_PERIODS).default("monthly"),
    valid_from: dateStr,
    valid_to: optionalDate,
    notes: optionalNotes,
  })
  .refine((d) => !d.valid_to || d.valid_to >= d.valid_from, {
    message: "El fin de vigencia no puede ser anterior al inicio.",
    path: ["valid_to"],
  });

export type StorageTariffCreateInput = z.infer<typeof StorageTariffCreateSchema>;

export const StorageTariffUpdateSchema = z.object({
  id: z.string().uuid(),
  client_id: optionalUuid,
  rate_per_pallet: z.coerce.number().positive().optional(),
  period: z.enum(TARIFF_PERIODS).optional(),
  valid_from: dateStr.optional(),
  valid_to: optionalDate,
  is_active: z.boolean().optional(),
  notes: optionalNotes,
});

export const StorageTariffToggleSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});
