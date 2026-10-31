"use server";

import { gatedRead } from "@/lib/actions/gated-read";
import type { ActionResult } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";

import {
  SupplierPriceEvolutionInputSchema,
  SupplierPurchasesSummaryInputSchema,
  SupplierUpcomingDuesInputSchema,
  type SupplierPriceEvolutionRow,
  type SupplierPurchasesSummaryRow,
  type SupplierUpcomingDueRow,
} from "../reports-schema";

// Supplier purchase / payables aggregates over security-invoker RPCs. Each
// reads suppliers plus purchase invoices (and payment orders for the
// summary), so it needs every one of those reads.

const DENIED = "No tenés permiso para ver compras por proveedor.";
const FAILED = "No se pudo calcular el reporte de proveedores.";

export async function getSupplierPurchasesSummaryAction(
  input: unknown,
): Promise<ActionResult<SupplierPurchasesSummaryRow[]>> {
  return gatedRead({
    permissions: [
      "suppliers:read",
      "purchase_invoices:read",
      "payment_orders:read",
    ],
    denied: DENIED,
    failure: FAILED,
    schema: SupplierPurchasesSummaryInputSchema,
    input,
    event: "suppliers.purchases_summary.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_supplier_purchases_summary", {
        p_from: v.from,
        p_to: v.to,
        p_supplier_id: v.supplierId ?? undefined,
        p_category_id: v.categoryId ?? undefined,
        p_limit: v.limit ?? 50,
        p_is_fiscal: isFiscalFor(v.scope ?? "all") ?? undefined,
      }),
  });
}

export async function getSupplierUpcomingDuesAction(
  input: unknown,
): Promise<ActionResult<SupplierUpcomingDueRow[]>> {
  return gatedRead({
    permissions: [
      "suppliers:read",
      "purchase_invoices:read",
      "payment_orders:read",
    ],
    denied: DENIED,
    failure: FAILED,
    schema: SupplierUpcomingDuesInputSchema,
    input,
    event: "suppliers.upcoming_dues.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_supplier_upcoming_dues", {
        p_days: v.days ?? 30,
        p_supplier_id: v.supplierId ?? undefined,
        p_limit: v.limit ?? 100,
        p_is_fiscal: isFiscalFor(v.scope ?? "all") ?? undefined,
      }),
  });
}

export async function getSupplierPriceEvolutionAction(
  input: unknown,
): Promise<ActionResult<SupplierPriceEvolutionRow[]>> {
  return gatedRead({
    permissions: ["suppliers:read", "purchase_invoices:read"],
    denied: DENIED,
    failure: FAILED,
    schema: SupplierPriceEvolutionInputSchema,
    input,
    event: "suppliers.price_evolution.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_supplier_price_evolution", {
        p_from: v.from,
        p_to: v.to,
        p_group_by: v.groupBy ?? "supplier",
        p_supplier_id: v.supplierId ?? undefined,
        p_category_id: v.categoryId ?? undefined,
        p_item_query: v.itemQuery ?? undefined,
        p_limit: v.limit ?? 300,
        p_is_fiscal: isFiscalFor(v.scope ?? "all") ?? undefined,
      }),
  });
}
