import { z } from "zod";

const dateRe = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).");

const StorageInvoiceFields = z.object({
  client_id: z.string().uuid("Cliente requerido."),
  period_start: dateRe,
  period_end: dateRe,
  channel_id: z.string().min(1, "Canal requerido."),
  punto_venta: z.coerce
    .number()
    .int("Punto de venta inválido.")
    .positive("Punto de venta inválido."),
});

function checkPeriod(
  d: { period_start: string; period_end: string },
  ctx: z.RefinementCtx,
): void {
  if (d.period_end < d.period_start) {
    ctx.addIssue({
      code: "custom",
      message: "El hasta no puede ser anterior al desde.",
      path: ["period_end"],
    });
  }
}

/** Input to invoice a client's storage for an arbitrary [start, end] period. */
export const StorageInvoiceSchema =
  StorageInvoiceFields.superRefine(checkPeriod);
export type StorageInvoiceInput = z.infer<typeof StorageInvoiceSchema>;

/** The same invoice at the total an assistant proposal showed: billing is
 *  refused if the server recomputes another one. */
export const StorageInvoiceProposalSchema = StorageInvoiceFields.extend({
  expected_total: z
    .number()
    .finite()
    .positive("No hay nada para facturar en ese período.")
    .max(999_999_999_999.99),
}).superRefine(checkPeriod);

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
  channel_id: string | null;
  /** Set while the run is a claim whose invoice is not linked yet. */
  pending_since: string | null;
  created_at: string;
}
