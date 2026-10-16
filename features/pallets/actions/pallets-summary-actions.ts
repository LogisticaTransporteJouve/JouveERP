"use server";

import { z } from "zod";

import { gatedRead } from "@/lib/actions/gated-read";
import type { ActionResult } from "@/lib/query/run-action";

import type { PalletsSummaryRow } from "../schema";

/** Current pallets in stock and 30-day movement per warehouse and client
 *  (ai_pallets_summary, security invoker). Gated on pallets:read. */
export async function getPalletsSummaryAction(): Promise<
  ActionResult<PalletsSummaryRow[]>
> {
  return gatedRead({
    permissions: ["pallets:read"],
    denied: "No tenés permiso para ver pallets.",
    failure: "No se pudo calcular el stock de pallets.",
    schema: z.object({}),
    input: {},
    event: "pallets.summary.failed",
    query: (supabase) => supabase.rpc("ai_pallets_summary"),
  });
}
