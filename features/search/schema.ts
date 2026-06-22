import { z } from "zod";

export const SearchGlobalInputSchema = z.object({
  query: z.string().trim().max(200, "Búsqueda demasiado larga."),
  limit: z.number().int().min(1).max(50).optional(),
});

export type SearchGlobalInput = z.infer<typeof SearchGlobalInputSchema>;

export type SearchResult = {
  entity_type: string;
  entity_id: string;
  title: string;
  subtitle: string | null;
  url: string;
  rank: number;
};

export const ENTITY_LABEL: Record<string, string> = {
  client: "Cliente",
  supplier: "Proveedor",
  invoice: "Comprobante",
  purchase_invoice: "Compra",
  receipt: "Recibo",
  payment_order: "Orden de pago",
  transaction: "Movimiento",
};
