"use server";

import { z } from "zod";

import { gatedRead } from "@/lib/actions/gated-read";
import type { ActionResult } from "@/lib/query/run-action";

import type { AfipLastNumberRow } from "../schema";

/**
 * Last emitted voucher number and date per sales point, kind and letter
 * (ai_afip_last_numbers, security invoker). Database only: it never calls
 * AFIP. Gated on afip:admin like the rest of the AFIP administration.
 */
export async function getAfipLastNumbersAction(): Promise<
  ActionResult<AfipLastNumberRow[]>
> {
  return gatedRead({
    permissions: ["afip:admin"],
    denied: "No tenés permiso para administrar AFIP.",
    failure: "No se pudo leer la numeración.",
    schema: z.object({}),
    input: {},
    event: "afip.last_numbers.failed",
    query: (supabase) => supabase.rpc("ai_afip_last_numbers"),
  });
}
