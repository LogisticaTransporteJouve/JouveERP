"use server";

import { gatedRead } from "@/lib/actions/gated-read";
import type { ActionResult } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";

import {
  ClientSalesSummaryInputSchema,
  type ClientSalesSummaryRow,
} from "../reports-schema";

/**
 * Per-client invoiced / collected / days-to-pay / open and overdue balance
 * over a date range (ai_client_sales_summary, security invoker). It reads
 * invoices, receipts and the aging view, so it needs all three reads.
 */
export async function getClientSalesSummaryAction(
  input: unknown,
): Promise<ActionResult<ClientSalesSummaryRow[]>> {
  return gatedRead({
    permissions: ["clients:read", "invoices:read", "receipts:read"],
    denied: "No tenés permiso para ver ventas y cobranzas por cliente.",
    failure: "No se pudo calcular el resumen por cliente.",
    schema: ClientSalesSummaryInputSchema,
    input,
    event: "clients.sales_summary.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_client_sales_summary", {
        p_from: v.from,
        p_to: v.to,
        p_client_id: v.clientId ?? undefined,
        p_limit: v.limit ?? 50,
        p_is_fiscal: isFiscalFor(v.scope ?? "all") ?? undefined,
      }),
  });
}
