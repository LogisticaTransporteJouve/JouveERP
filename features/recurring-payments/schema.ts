import { z } from "zod";

export const RECURRING_CATEGORIES = [
  "alquiler",
  "servicios",
  "prestamo",
  "impuesto",
  "sueldo",
  "otro",
] as const;
export type RecurringCategory = (typeof RECURRING_CATEGORIES)[number];

export const RECURRING_FREQUENCIES = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const RECURRING_CURRENCIES = ["ARS", "USD"] as const;
export type RecurringCurrency = (typeof RECURRING_CURRENCIES)[number];

export const RECURRING_CATEGORY_LABELS: Record<RecurringCategory, string> = {
  alquiler: "Alquiler",
  servicios: "Servicios",
  prestamo: "Préstamo",
  impuesto: "Impuesto",
  sueldo: "Sueldo fijo",
  otro: "Otro",
};

export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "Semanal",
  monthly: "Mensual",
  quarterly: "Trimestral",
  yearly: "Anual",
};

export function isRecurringCategory(v: unknown): v is RecurringCategory {
  return (
    typeof v === "string" &&
    (RECURRING_CATEGORIES as readonly string[]).includes(v)
  );
}
export function isRecurringFrequency(v: unknown): v is RecurringFrequency {
  return (
    typeof v === "string" &&
    (RECURRING_FREQUENCIES as readonly string[]).includes(v)
  );
}
export function isRecurringCurrency(v: unknown): v is RecurringCurrency {
  return (
    typeof v === "string" &&
    (RECURRING_CURRENCIES as readonly string[]).includes(v)
  );
}

export interface RecurringPayment {
  id: string;
  description: string;
  category: RecurringCategory;
  amount: number;
  currency: RecurringCurrency;
  frequency: RecurringFrequency;
  next_due_date: string;
  end_date: string | null;
  account_id: string | null;
  channel_id: string | null;
  cost_center_id: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
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

// invoicing_channels.id is a text slug (not a uuid), so channel_id is loose.
const optionalChannel = z
  .string()
  .trim()
  .max(100)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

const optionalNotes = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

export const RecurringPaymentCreateSchema = z
  .object({
    description: z.string().trim().min(1, "Descripción requerida.").max(200),
    category: z.enum(RECURRING_CATEGORIES),
    amount: z.coerce.number().positive("El monto debe ser mayor a 0."),
    currency: z.enum(RECURRING_CURRENCIES).default("ARS"),
    frequency: z.enum(RECURRING_FREQUENCIES),
    next_due_date: dateStr,
    end_date: optionalDate,
    account_id: optionalUuid,
    channel_id: optionalChannel,
    cost_center_id: optionalUuid,
    notes: optionalNotes,
  })
  .refine((d) => !d.end_date || d.end_date >= d.next_due_date, {
    message: "El fin no puede ser anterior al próximo vencimiento.",
    path: ["end_date"],
  });

export type RecurringPaymentCreateInput = z.infer<
  typeof RecurringPaymentCreateSchema
>;

export const RecurringPaymentUpdateSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().min(1).max(200).optional(),
  category: z.enum(RECURRING_CATEGORIES).optional(),
  amount: z.coerce.number().positive().optional(),
  currency: z.enum(RECURRING_CURRENCIES).optional(),
  frequency: z.enum(RECURRING_FREQUENCIES).optional(),
  next_due_date: dateStr.optional(),
  end_date: optionalDate,
  account_id: optionalUuid,
  channel_id: optionalChannel,
  cost_center_id: optionalUuid,
  is_active: z.boolean().optional(),
  notes: optionalNotes,
});

export const RecurringPaymentToggleSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});
