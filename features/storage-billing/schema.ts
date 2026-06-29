import { z } from "zod";

const dateRe = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).");

/** Input to invoice a client's storage for an arbitrary [start, end] period. */
export const StorageInvoiceSchema = z
  .object({
    client_id: z.string().uuid("Cliente requerido."),
    period_start: dateRe,
    period_end: dateRe,
    channel_id: z.string().uuid("Canal requerido."),
    punto_venta: z.coerce
      .number()
      .int("Punto de venta inválido.")
      .positive("Punto de venta inválido."),
  })
  .refine((d) => d.period_end >= d.period_start, {
    message: "El hasta no puede ser anterior al desde.",
    path: ["period_end"],
  });
export type StorageInvoiceInput = z.infer<typeof StorageInvoiceSchema>;

export interface StorageBillingRun {
  id: string;
  client_id: string;
  client_name: string;
  period_start: string;
  period_end: string;
  storage_total: number;
  handling_in_total: number;
  handling_out_total: number;
  total: number;
  invoice_id: string | null;
  created_at: string;
}
