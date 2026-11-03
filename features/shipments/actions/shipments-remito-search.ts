"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import { remitoMatches } from "../lib/format";

const RemitoSearchSchema = z.object({
  sales_point: z.number().int().min(0).max(99999).nullable(),
  number: z.number().int().min(1).max(99_999_999),
});

export type ShipmentByRemito = {
  id: string;
  remito_number: string;
  client_name: string | null;
  scheduled_date: string | null;
  status: string;
};

/**
 * The cargas whose client remito is the scanned one (Document Intelligence →
 * remito): punto de venta and number compared as numbers, whatever the
 * zeros, dashes or spaces the carga was typed with. Cancelled ones aside.
 */
export async function findShipmentsByRemitoAction(input: {
  sales_point: number | null;
  number: number;
}): Promise<ActionResult<ShipmentByRemito[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "shipments:read")) {
    return { ok: false, error: "No tenés permiso para ver cargas." };
  }
  const parsed = RemitoSearchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Remito inválido." };

  const supabase = await createSupabaseClient();
  // The number's digits appear in the typed remito; the exact comparison
  // runs below. Capped: a remito matches a handful of cargas at most.
  const { data, error } = await supabase
    .from("shipments")
    .select(
      "id, remito_number, scheduled_date, status, client:clients(legal_name)",
    )
    .ilike("remito_number", `%${parsed.data.number}%`)
    .neq("status", "cancelled")
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .order("id")
    .limit(200);
  if (error) {
    logger.error("shipments.remito_search.failed", {
      userId: ctx.userId,
      error,
    });
    return { ok: false, error: "No se pudieron buscar las cargas." };
  }
  return {
    ok: true,
    data: (data ?? [])
      .filter(
        (s): s is typeof s & { remito_number: string } =>
          s.remito_number !== null &&
          remitoMatches(s.remito_number, parsed.data),
      )
      .slice(0, 10)
      .map((s) => ({
        id: s.id,
        remito_number: s.remito_number,
        client_name: s.client?.legal_name ?? null,
        scheduled_date: s.scheduled_date,
        status: s.status,
      })),
  };
}
