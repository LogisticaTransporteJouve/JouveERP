"use server";

import { gatedRead } from "@/lib/actions/gated-read";
import type { ActionResult } from "@/lib/query/run-action";

import {
  ShipmentsSummaryInputSchema,
  type ShipmentsSummaryRow,
} from "../schema";

/** Shipments per status and client in a date range: count, freight and
 *  invoiced count (ai_shipments_summary, security invoker). */
export async function getShipmentsSummaryAction(
  input: unknown,
): Promise<ActionResult<ShipmentsSummaryRow[]>> {
  return gatedRead({
    permissions: ["shipments:read"],
    denied: "No tenés permiso para ver cargas.",
    failure: "No se pudo calcular el resumen de cargas.",
    schema: ShipmentsSummaryInputSchema,
    input,
    event: "shipments.summary.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_shipments_summary", { p_from: v.from, p_to: v.to }),
  });
}
