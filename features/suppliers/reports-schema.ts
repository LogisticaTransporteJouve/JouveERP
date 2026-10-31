import { z } from "zod";

import type { Database } from "@/lib/db/database.types";
import {
  IsoDateSchema,
  ScopeInputSchema,
  UuidSchema,
} from "@/lib/validation/common";

type Fn = Database["public"]["Functions"];

// Inputs of the supplier purchase / payables reads. The `.describe()` texts
// double as the assistant's tool parameter docs.

const dateRange = {
  from: IsoDateSchema.describe("Fecha desde, YYYY-MM-DD."),
  to: IsoDateSchema.describe("Fecha hasta, YYYY-MM-DD (inclusive)."),
};

const limit = (max: number, fallback: number) =>
  z
    .number()
    .int()
    .min(1)
    .max(max)
    .nullish()
    .describe(`Máximo de filas (default ${fallback}).`);

export const SupplierPurchasesSummaryInputSchema = z
  .object({
    ...dateRange,
    supplierId: UuidSchema.nullish().describe(
      "UUID de un proveedor (opcional).",
    ),
    categoryId: UuidSchema.nullish().describe(
      "UUID de una categoría de proveedor (opcional).",
    ),
    scope: ScopeInputSchema,
    limit: limit(500, 50),
  })
  .refine(
    (v) => v.from <= v.to,
    "La fecha desde es posterior a la fecha hasta.",
  );

export const SupplierUpcomingDuesInputSchema = z.object({
  days: z
    .number()
    .int()
    .min(0)
    .max(365)
    .nullish()
    .describe("Ventana en días desde hoy (default 30). Incluye lo vencido."),
  supplierId: UuidSchema.nullish().describe("UUID de un proveedor (opcional)."),
  scope: ScopeInputSchema,
  limit: limit(500, 100),
});

export const PRICE_EVOLUTION_GROUPS = ["supplier", "category", "item"] as const;

export const SupplierPriceEvolutionInputSchema = z
  .object({
    ...dateRange,
    groupBy: z
      .enum(PRICE_EVOLUTION_GROUPS)
      .nullish()
      .describe(
        "supplier (default) o category: neto mensual; item: precio unitario promedio por ítem (requiere proveedor, categoría o texto).",
      ),
    supplierId: UuidSchema.nullish().describe(
      "UUID de un proveedor (opcional).",
    ),
    categoryId: UuidSchema.nullish().describe(
      "UUID de una categoría de proveedor (opcional).",
    ),
    itemQuery: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .nullish()
      .describe("Texto contenido en la descripción del ítem (opcional)."),
    scope: ScopeInputSchema,
    limit: limit(1000, 300),
  })
  .refine(
    (v) => v.from <= v.to,
    "La fecha desde es posterior a la fecha hasta.",
  )
  .refine(
    (v) =>
      v.groupBy !== "item" ||
      Boolean(v.supplierId || v.categoryId || v.itemQuery),
    "Por ítem, filtrá por proveedor, categoría o texto del ítem.",
  );

export type SupplierPurchasesSummaryRow =
  Fn["ai_supplier_purchases_summary"]["Returns"][number];
export type SupplierUpcomingDueRow =
  Fn["ai_supplier_upcoming_dues"]["Returns"][number];
export type SupplierPriceEvolutionRow =
  Fn["ai_supplier_price_evolution"]["Returns"][number];
