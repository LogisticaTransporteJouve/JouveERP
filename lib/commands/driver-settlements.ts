import "server-only";

import type { z } from "zod";

import type {
  DriverSettlementDifferenceInput,
  DriverSettlementSaveSchema,
} from "@/features/driver-settlements/schema";
import { logAudit } from "@/lib/actions/audit";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";

// Rendición de chofer writes. The callers have already checked
// `receipts:write` (plus hr:write + transactions:write to charge a
// difference to the driver) and parsed the input with the feature's schema:
// the rendición dialogs and an accepted assistant proposal.

/** Creates a draft (no id) or replaces a draft's date, notes, cargas and
 *  payment lines (save_driver_settlement, one transaction), and audits it. */
export async function saveDriverSettlement(
  actorId: string,
  d: z.output<typeof DriverSettlementSaveSchema>,
): Promise<ActionResult<{ id: string }>> {
  const { data, error } = await getServiceClient().rpc(
    "save_driver_settlement",
    {
      p_driver_id: d.driver_id,
      p_settlement_date: d.settlement_date,
      p_notes: d.notes ?? "",
      p_items: d.items.map((item) => ({
        shipment_id: item.shipment_id,
        note: item.note ?? null,
        lines: item.lines.map((l) => ({
          account_id: l.account_id,
          amount: l.amount,
          reference: l.reference ?? null,
          check_number: l.check_number ?? null,
          bank_name: l.bank_name ?? null,
          drawer_name: l.drawer_name ?? null,
          drawer_cuit: l.drawer_cuit ?? null,
          check_issue_date: l.check_issue_date ?? null,
          check_due_date: l.check_due_date ?? null,
        })),
      })),
      p_user_id: actorId,
      ...(d.id ? { p_settlement_id: d.id } : {}),
    },
  );
  if (error || !data) {
    const guardError = mapDbGuardError(error, {
      slug: "driver_settlements.save.rejected",
      userId: actorId,
      id: d.id ?? null,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("driver_settlements.save.failed", { userId: actorId, error });
    return { ok: false, error: "No se pudo guardar la rendición." };
  }

  const received = round2(
    d.items.reduce((s, i) => s + i.lines.reduce((t, l) => t + l.amount, 0), 0),
  );
  await logAudit(
    d.id ? "driver_settlement.updated" : "driver_settlement.created",
    actorId,
    {
      driver_id: d.driver_id,
      settlement_date: d.settlement_date,
      cargas: d.items.length,
      received,
    },
    data,
  );
  return { ok: true, data: { id: data } };
}

/** What an assistant proposal showed: refused if the rendición no longer
 *  adds up to it when it is confirmed. */
export type ExpectedSettlementTotals = {
  expected_total: number;
  received_total: number;
};

/** Posts the rendición as receipts, one per client and channel
 *  (confirm_driver_settlement, one transaction). Confirming twice returns
 *  the same receipts. With `expected` the database refuses, rolling back,
 *  when the totals changed. */
export async function confirmDriverSettlement(
  actorId: string,
  id: string,
  expected?: ExpectedSettlementTotals,
): Promise<ActionResult<{ receiptIds: string[] }>> {
  const { data, error } = await getServiceClient().rpc(
    "confirm_driver_settlement",
    {
      p_settlement_id: id,
      p_user_id: actorId,
      ...(expected
        ? {
            p_expected_total: expected.expected_total,
            p_received_total: expected.received_total,
          }
        : {}),
    },
  );
  if (error || !data) {
    const guardError = mapDbGuardError(error, {
      slug: "driver_settlements.confirm.rejected",
      userId: actorId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("driver_settlements.confirm.failed", {
      userId: actorId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo confirmar la rendición." };
  }

  await logAudit(
    "driver_settlement.confirmed",
    actorId,
    { receipt_ids: data },
    id,
  );
  return { ok: true, data: { receiptIds: data } };
}

/** "Resolver diferencia" (post_driver_settlement_difference): `driver`
 *  settles a shortfall with a receipt and charges it to the driver's
 *  employee account as an advance out of the cash account; `client` only
 *  records the choice. Resolving twice the same way returns the same
 *  result. A `driver` caller has also checked CHARGE_DRIVER_PERMISSIONS. */
export async function postDriverSettlementDifference(
  actorId: string,
  { id, charged_to }: DriverSettlementDifferenceInput,
): Promise<ActionResult<{ movementId: string | null }>> {
  const { data, error } = await getServiceClient().rpc(
    "post_driver_settlement_difference",
    { p_settlement_id: id, p_user_id: actorId, p_charged_to: charged_to },
  );
  if (error || (charged_to === "driver" && !data)) {
    const guardError = mapDbGuardError(error, {
      slug: "driver_settlements.difference.rejected",
      userId: actorId,
      id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("driver_settlements.difference.failed", {
      userId: actorId,
      id,
      error,
    });
    return { ok: false, error: "No se pudo asentar la diferencia." };
  }

  await logAudit(
    "driver_settlement.difference_posted",
    actorId,
    { charged_to, movement_id: data ?? null },
    id,
  );
  return { ok: true, data: { movementId: data ?? null } };
}
