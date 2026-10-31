"use server";

import { gatedRead } from "@/lib/actions/gated-read";
import type { ActionResult } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";

import { FleetMarginInputSchema, type FleetMarginRow } from "../schema";

/**
 * Fleet margin per trip / driver / vehicle / client over a date range, with
 * the profitability report's fuel and maintenance imputation, computed in SQL
 * (ai_fleet_margin, security invoker). Gated on trips:read like the report.
 */
export async function getFleetMarginAction(
  input: unknown,
): Promise<ActionResult<FleetMarginRow[]>> {
  return gatedRead({
    permissions: ["trips:read"],
    denied: "No tenés permiso para ver la rentabilidad.",
    failure: "No se pudo calcular el margen de flota.",
    schema: FleetMarginInputSchema,
    input,
    event: "fleet.margin.failed",
    query: (supabase, v) =>
      supabase.rpc("ai_fleet_margin", {
        p_from: v.from,
        p_to: v.to,
        p_group_by: v.groupBy ?? "vehicle",
        p_limit: v.limit ?? 50,
        p_is_fiscal: isFiscalFor(v.scope ?? "all") ?? undefined,
      }),
  });
}
