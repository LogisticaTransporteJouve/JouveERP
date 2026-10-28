import { z } from "zod";

import type { EntityType } from "@/lib/auth/entity-permissions";

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

/** The entity types public.search_global indexes. */
export const SEARCH_ENTITY_TYPES = [
  "client",
  "supplier",
  "invoice",
  "purchase_invoice",
  "receipt",
  "payment_order",
  "transaction",
] as const satisfies readonly EntityType[];

export const ENTITY_LABEL: Record<string, string> = {
  client: "Cliente",
  supplier: "Proveedor",
  invoice: "Comprobante",
  purchase_invoice: "Compra",
  receipt: "Recibo",
  payment_order: "Orden de pago",
  transaction: "Movimiento",
};
