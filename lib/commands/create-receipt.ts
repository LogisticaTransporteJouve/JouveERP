import "server-only";

import {
  allocationPayload,
  allocationTargetId,
  type PendingComprobante,
  type ReceiptCreateInput,
} from "@/features/receipts/schema";
import { logAudit } from "@/lib/actions/audit";
import {
  allocateFifo,
  allocationsIssue,
  resolveAllocations,
} from "@/lib/allocations";
import { loadChannelPos } from "@/lib/channel-pos";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

/** The client's open comprobantes and rejected checks on a channel:
 *  listPendingComprobantesForClientAction, injected so lib/ never imports a
 *  feature's action. */
export type ListPendingComprobantes = (
  clientId: string,
  channelId: string,
) => Promise<ActionResult<PendingComprobante[]>>;

/**
 * Issues a recibo de cobranza with the caller's session: the receipt, its
 * payment lines (a check line also loads the check into its cartera), its
 * allocations and retentions in one transaction (RPC `create_receipt`), then
 * the audit. Without manual allocations the total goes FIFO over the
 * client's pending comprobantes of the receipt's currency; manual ones are
 * checked against that same list (the DB guards have the last word).
 *
 * The caller has already checked `receipts:write` (and `retentions:write`
 * when it carries retentions) and parsed the input with
 * `ReceiptCreateSchema`: «Nuevo recibo», an accepted assistant proposal and
 * the eCheq listado import.
 */
export async function createReceipt(
  actorId: string,
  data: ReceiptCreateInput,
  listPending: ListPendingComprobantes,
): Promise<ActionResult<{ id: string; numero: number; punto_venta: number }>> {
  const pos = await loadChannelPos(data.channel_id);
  if (!pos) {
    return {
      ok: false,
      error: `El canal ${data.channel_id} no tiene un punto de venta habilitado.`,
    };
  }

  // The receipt's total includes its retentions (Σ payment lines + Σ
  // retentions): the journal entry and the account statement credit the
  // client for all of it, so all of it is distributed. Without manual
  // allocations it goes FIFO over the pending comprobantes; manual ones are
  // checked against the same pending list (the DB guards have the last word).
  const pendingRes = await listPending(data.client_id, data.channel_id);
  if (!pendingRes.ok) return pendingRes;
  const pending = pendingRes.data.filter((c) => c.currency === data.currency);
  // FIFO settles comprobantes only: a rejected check is settled when the
  // user picks it. "A cuenta" applies nothing.
  const resolved = resolveAllocations(
    data.allocation_mode,
    data.allocations ?? [],
    () =>
      allocateFifo(
        pending.filter((c) => c.document_type === "invoice"),
        data.total_amount,
      ).map((a) => ({
        invoice_id: a.document_id,
        amount_applied: a.amount_applied,
      })),
  );
  if ("issue" in resolved) return { ok: false, error: resolved.issue };
  const allocations = resolved.allocations;
  const otherCurrency = new Set(
    pendingRes.data
      .filter((c) => c.currency !== data.currency)
      .map((c) => c.id),
  );
  if (allocations.some((a) => otherCurrency.has(allocationTargetId(a)))) {
    return {
      ok: false,
      error:
        "Un comprobante imputado está en otra moneda que el recibo: un recibo solo cancela comprobantes de su misma moneda.",
    };
  }
  if (resolved.manual) {
    const issue = allocationsIssue(
      pending,
      allocations.map((a) => ({
        document_id: allocationTargetId(a),
        amount_applied: a.amount_applied,
      })),
      data.total_amount,
    );
    if (issue) return { ok: false, error: issue };
  }

  const supabase = await createClient();
  const { data: receiptId, error } = await supabase.rpc("create_receipt", {
    p_channel_id: data.channel_id,
    p_punto_venta: pos.punto_venta,
    p_numero: data.numero,
    p_client_id: data.client_id,
    p_recibo_date: data.receipt_date,
    p_total_amount: data.total_amount,
    p_currency: data.currency,
    p_cotizacion: data.cotizacion ?? undefined,
    p_notes: data.notes ?? "",
    p_payment_lines: data.payment_lines.map((l) => ({
      account_id: l.account_id,
      amount: l.amount,
      reference: l.reference ?? null,
      check: l.check
        ? {
            check_number: l.check.check_number ?? null,
            bank_name: l.check.bank_name,
            drawer_name: l.check.drawer_name,
            drawer_cuit: l.check.drawer_cuit ?? null,
            issue_date: l.check.issue_date ?? null,
            due_date: l.check.due_date,
            notes: l.check.notes ?? null,
          }
        : null,
    })),
    p_allocations: allocations.map(allocationPayload),
    p_retentions: (data.retentions ?? []).map((r) => ({
      kind: r.kind,
      tax_type: r.tax_type,
      jurisdiction: r.jurisdiction ?? null,
      certificate_number: r.certificate_number,
      certificate_date: r.certificate_date,
      amount: r.amount,
      notes: r.notes ?? null,
    })),
  });

  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "receipts.create.rejected",
      userId: actorId,
    });
    if (guardError) return { ok: false, error: guardError };
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: `El número ${data.numero} ya existe para ese canal/POS.`,
      };
    }
    logger.error("receipts.create.failed", {
      userId: actorId,
      channel_id: data.channel_id,
      numero: data.numero,
      client_id: data.client_id,
      error,
    });
    return {
      ok: false,
      error: "No se pudo crear el recibo.",
    };
  }

  await logAudit(
    "receipt.created",
    actorId,
    {
      channel_id: data.channel_id,
      numero: data.numero,
      total_amount: data.total_amount,
      client_id: data.client_id,
    },
    receiptId as string,
  );
  return {
    ok: true,
    data: {
      id: receiptId as string,
      numero: data.numero,
      punto_venta: pos.punto_venta,
    },
  };
}
