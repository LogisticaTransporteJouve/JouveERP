import "server-only";

import {
  serializePaymentLine,
  type PaymentOrderCreateInput,
  type PendingPurchaseInvoice,
} from "@/features/payment-orders/schema";
import { logAudit } from "@/lib/actions/audit";
import { allocateFifo, resolveAllocations } from "@/lib/allocations";
import { loadChannelPos } from "@/lib/channel-pos";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/** The supplier's open purchases on a channel:
 *  listPendingInvoicesForSupplierAction, injected so lib/ never imports a
 *  feature's action. */
export type ListPendingPurchases = (
  supplierId: string,
  channelId: string,
) => Promise<ActionResult<PendingPurchaseInvoice[]>>;

/**
 * Issues an orden de pago with the caller's session: the OP, its payment
 * lines (an account, an endorsed check or a check issued from a chequera)
 * and its allocations in one transaction (RPC `create_payment_order`), then
 * the audit. FIFO goes over the supplier's pending purchases of the OP's
 * currency; picked allocations are checked by the DB guards; "a cuenta"
 * applies nothing.
 *
 * The caller has already checked `payment_orders:write` and parsed the input
 * with `PaymentOrderCreateSchema`: «Nueva orden de pago» and an accepted
 * assistant proposal.
 */
export async function createPaymentOrder(
  actorId: string,
  data: PaymentOrderCreateInput,
  listPending: ListPendingPurchases,
): Promise<ActionResult<{ id: string; numero: number; punto_venta: number }>> {
  const pos = await loadChannelPos(data.channel_id);
  if (!pos) {
    return {
      ok: false,
      error: `El canal ${data.channel_id} no tiene un punto de venta habilitado.`,
    };
  }

  // FIFO over the pending purchases in the OP's currency, the picked ones
  // (the DB guards check them), or nothing ("a cuenta").
  let fifo: { purchase_invoice_id: string; amount_applied: number }[] = [];
  const picked = data.allocations ?? [];
  if (
    data.allocation_mode === "fifo" ||
    (data.allocation_mode === undefined && picked.length === 0)
  ) {
    const pendingRes = await listPending(data.supplier_id, data.channel_id);
    if (!pendingRes.ok) return pendingRes;
    fifo = allocateFifo(
      pendingRes.data.filter((c) => c.currency === data.currency),
      data.total_amount,
    ).map((a) => ({
      purchase_invoice_id: a.document_id,
      amount_applied: a.amount_applied,
    }));
  }
  const resolved = resolveAllocations(data.allocation_mode, picked, () => fifo);
  if ("issue" in resolved) return { ok: false, error: resolved.issue };
  const allocations = resolved.allocations;

  const supabase = await createClient();
  const { data: opId, error } = await supabase.rpc("create_payment_order", {
    p_channel_id: data.channel_id,
    p_punto_venta: pos.punto_venta,
    p_numero: data.numero,
    p_supplier_id: data.supplier_id,
    p_payment_date: data.payment_date,
    p_total_amount: data.total_amount,
    p_currency: data.currency,
    p_cotizacion: data.cotizacion ?? undefined,
    p_notes: data.notes ?? "",
    p_payment_lines: data.payment_lines.map(serializePaymentLine),
    p_allocations: allocations.map((a) => ({
      purchase_invoice_id: a.purchase_invoice_id,
      amount_applied: a.amount_applied,
    })),
  });

  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "payment_orders.create.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: `El número ${data.numero} ya existe para ese canal/POS.`,
      };
    }
    logger.error("payment_orders.create.failed", {
      userId: actorId,
      channel_id: data.channel_id,
      numero: data.numero,
      supplier_id: data.supplier_id,
      error,
    });
    return {
      ok: false,
      error: "No se pudo crear la orden de pago.",
    };
  }

  await logAudit(
    "payment_order.created",
    actorId,
    {
      channel_id: data.channel_id,
      numero: data.numero,
      total_amount: data.total_amount,
      supplier_id: data.supplier_id,
    },
    opId as string,
  );
  return {
    ok: true,
    data: {
      id: opId as string,
      numero: data.numero,
      punto_venta: pos.punto_venta,
    },
  };
}
