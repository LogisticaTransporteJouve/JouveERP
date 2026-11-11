"use server";

import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCanAll } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { UuidSchema } from "@/lib/validation/common";

/** A trip's revenue (v_trip_revenue), and its freight and shipments still to
 *  invoice (not in revenue). */
export type TripRevenue = {
  trip_id: string;
  revenue: number;
  uninvoiced_freight: number;
  uninvoiced_shipments: number;
};

/**
 * Each trip's revenue (v_trip_revenue: invoiced freight of its shipments,
 * else the manual figure) and its freight still to invoice, drained: every
 * trip, or only `tripIds` when given. Gated on trips:read plus
 * shipments:read, since the revenue comes from the shipments.
 */
export async function listTripRevenueAction(
  tripIds?: readonly string[],
): Promise<ActionResult<TripRevenue[]>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, ["trips:read", "shipments:read"])) {
    return {
      ok: false,
      error: "No tenés permiso para ver el ingreso de los viajes.",
    };
  }
  const ids = z.array(UuidSchema).optional().safeParse(tripIds);
  if (!ids.success) return { ok: false, error: "Viajes inválidos." };
  const supabase = await createSupabaseClient();
  const columns = "trip_id, revenue, uninvoiced_freight, uninvoiced_shipments";
  const { data, error } = ids.data
    ? await fetchInChunks(ids.data, (chunk) =>
        supabase.from("v_trip_revenue").select(columns).in("trip_id", chunk),
      )
    : await paginateRange((from, to) =>
        supabase
          .from("v_trip_revenue")
          .select(columns)
          .order("trip_id")
          .range(from, to),
      );
  if (error) {
    logger.error("fleet.trip_revenue.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo leer el ingreso de los viajes." };
  }
  const rows: TripRevenue[] = [];
  for (const r of data ?? []) {
    if (r.trip_id)
      rows.push({
        trip_id: r.trip_id,
        revenue: Number(r.revenue ?? 0),
        uninvoiced_freight: Number(r.uninvoiced_freight ?? 0),
        uninvoiced_shipments: Number(r.uninvoiced_shipments ?? 0),
      });
  }
  return { ok: true, data: rows };
}
