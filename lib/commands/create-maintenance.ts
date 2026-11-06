import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { MaintenanceCreateSchema } from "@/features/maintenance/schema";
import { logAudit } from "@/lib/actions/audit";
import type { Access } from "@/lib/auth/permissions";
import { costVoucherDenied, costVoucherPatch } from "@/lib/cost-vouchers";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";

/**
 * Inserts a maintenance record and audits it. A voucher link (purchase
 * invoice or movement) the user cannot see is refused. The caller has
 * already checked `maintenance:write` and parsed the input with
 * `MaintenanceCreateSchema`: the maintenance dialog and an accepted assistant
 * proposal. `db` is the user's client (maintenance_records' RLS).
 */
export async function createMaintenance(
  db: SupabaseClient<Database>,
  actor: { userId: string; access: Access },
  d: z.output<typeof MaintenanceCreateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const voucherDenied = costVoucherDenied(actor.access, d);
  if (voucherDenied) return { ok: false, error: voucherDenied };

  const { data, error } = await db
    .from("maintenance_records")
    .insert({
      vehicle_id: d.vehicle_id,
      service_date: d.service_date,
      kind: d.kind,
      description: d.description,
      cost: d.cost ?? null,
      odometer_km: d.odometer_km ?? null,
      next_service_date: d.next_service_date ?? null,
      next_service_km: d.next_service_km ?? null,
      provider: d.provider ?? null,
      notes: d.notes ?? null,
      ...costVoucherPatch(d),
      created_by: actor.userId,
    })
    .select("id")
    .single();
  if (error) {
    logger.error("maintenance.create.failed", { userId: actor.userId, error });
    return { ok: false, error: "No se pudo crear el mantenimiento." };
  }

  await logAudit(
    "maintenance.created",
    actor.userId,
    { service_date: d.service_date },
    data.id,
  );
  return { ok: true, data: { id: data.id } };
}
