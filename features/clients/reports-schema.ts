import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import {
  IsoDateSchema,
  ScopeInputSchema,
  UuidSchema,
} from "@/lib/validation/common";

// Input of the per-client sales/collections read. The `.describe()` texts
// double as the assistant's tool parameter docs.

export const ClientSalesSummaryInputSchema = z
  .object({
    from: IsoDateSchema.describe("Fecha desde, YYYY-MM-DD."),
    to: IsoDateSchema.describe("Fecha hasta, YYYY-MM-DD (inclusive)."),
    clientId: UuidSchema.nullish().describe("UUID de un cliente (opcional)."),
    scope: ScopeInputSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .nullish()
      .describe("Máximo de clientes en el ranking (default 50)."),
  })
  .refine(
    (v) => v.from <= v.to,
    "La fecha desde es posterior a la fecha hasta.",
  );

export type ClientSalesSummaryRow =
  Database["public"]["Functions"]["ai_client_sales_summary"]["Returns"][number];
