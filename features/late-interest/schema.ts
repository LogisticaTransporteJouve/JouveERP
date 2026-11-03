import { z } from "zod";

import { IsoDateSchema } from "@/lib/validation/common";

/** numeric(6, 3), a monthly percentage. */
const rateSchema = z.coerce
  .number({ message: "Ingresá una tasa." })
  .finite("Tasa inválida.")
  .min(0, "La tasa no puede ser negativa.")
  .max(100, "La tasa es mensual, en %: hasta 100.");

/** An overdue comprobante with open balance and what its next charge would
 *  be (late_interest_candidates + computeLateInterest). */
export interface LateInterestCandidate {
  invoice_id: string;
  client_id: string;
  client_name: string;
  channel_id: string;
  channel_is_fiscal: boolean;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number | null;
  fecha: string;
  due_date: string;
  moneda: string;
  open_amount: number;
  /** Last day already charged by a live ND; null = never. */
  charged_to: string | null;
  /** First day of the next charge. */
  charge_from: string;
  /** The client's own monthly %; null = it uses the general one. */
  client_rate: number | null;
  /** Monthly %, the client's or the general one; null = none set. */
  monthly_rate: number | null;
  /** Days from charge_from to the as-of date, inclusive (0 = nothing to
   *  charge). */
  days: number;
  /** Σ of the daily balance over those days (a payment in the period
   *  lowers it from its date on). */
  balance_days: number;
  /** Interest of those days at monthly_rate (0 without a rate). */
  interest: number;
}

export const LateInterestListSchema = z.object({
  as_of: IsoDateSchema,
  isFiscal: z.boolean().nullable().optional(),
});
export type LateInterestListInput = z.input<typeof LateInterestListSchema>;

export const IssueLateInterestSchema = z.object({
  invoice_id: z.string().uuid(),
  /** Last day charged (inclusive). */
  as_of: IsoDateSchema,
  /** Overrides the client's or the general rate for this ND. */
  monthly_rate: rateSchema.refine(
    (v) => v > 0,
    "La tasa tiene que ser mayor a 0.",
  ),
  punto_venta: z.coerce.number().int().min(1).max(99999),
});
export type IssueLateInterestInput = z.input<typeof IssueLateInterestSchema>;

/** Comprobantes one "Generar ND" in bulk takes (each one an AFIP call). */
export const MAX_BULK_NDS = 50;

export const IssueLateInterestBulkSchema = z.object({
  as_of: IsoDateSchema,
  items: z
    .array(IssueLateInterestSchema.omit({ as_of: true }))
    .min(1, "Elegí al menos un comprobante.")
    .max(MAX_BULK_NDS, `Hasta ${MAX_BULK_NDS} notas de débito por vez.`)
    .refine(
      (items) => new Set(items.map((i) => i.invoice_id)).size === items.length,
      "Un comprobante está dos veces.",
    ),
});
export type IssueLateInterestBulkInput = z.input<
  typeof IssueLateInterestBulkSchema
>;

/** One comprobante of a bulk run: its ND, or why it was not issued. */
export type LateInterestBulkResult = {
  invoice_id: string;
} & ({ ok: true; nd_invoice_id: string } | { ok: false; error: string });

export const GeneralRateSchema = z.object({
  /** null clears it. */
  monthly_rate: rateSchema.nullable(),
});
export type GeneralRateInput = z.input<typeof GeneralRateSchema>;

export const ClientRateSchema = z.object({
  client_id: z.string().uuid("Elegí un cliente."),
  /** null = the client uses the general rate. */
  monthly_rate: rateSchema.nullable(),
});
export type ClientRateInput = z.input<typeof ClientRateSchema>;
