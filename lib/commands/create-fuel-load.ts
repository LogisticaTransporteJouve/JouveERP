import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { FuelLoadCreateSchema } from "@/features/fuel/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Access } from "@/lib/auth/permissions";
import { costVoucherDenied, costVoucherPatch } from "@/lib/cost-vouchers";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

/**
 * Inserts a fuel load and audits it. A voucher link (purchase invoice or
 * movement) the user cannot see is refused. The caller has already checked
 * `fuel:write` and parsed the input with `FuelLoadCreateSchema`: the fuel
 * dialog and an accepted assistant proposal. `db` is the user's client
 * (fuel_loads' RLS).
 */
export async function createFuelLoad(
  db: SupabaseClient<Database>,
  actor: { userId: string; access: Access },
  d: z.output<typeof FuelLoadCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const voucherDenied = costVoucherDenied(actor.access, d);
  if (voucherDenied) return { ok: false, error: voucherDenied };

  const { data, error } = await db
    .from("fuel_loads")
    .insert({
      vehicle_id: d.vehicle_id,
      trip_id: d.trip_id ?? null,
      load_date: d.load_date,
      liters: d.liters,
      amount: d.amount,
      odometer_km: d.odometer_km ?? null,
      station: d.station ?? null,
      card: d.card ?? null,
      notes: d.notes ?? null,
      ...costVoucherPatch(d),
      created_by: actor.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("fuel.create.failed", { userId: actor.userId, error });
    return { ok: false, error: "No se pudo crear la carga." };
  }

  await logAudit(
    "fuel_load.created",
    actor.userId,
    { load_date: d.load_date },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
