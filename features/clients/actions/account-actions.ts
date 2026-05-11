"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type AccountMovementSourceType = "invoice" | "receipt";

export interface AccountMovement {
  source_type: AccountMovementSourceType;
  source_id: string;
  movement_date: string;
  created_at: string;
  /** comprobante kind ('factura' | 'nc' | 'nd') or 'recibo' */
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
  /** Positive = el cliente debe (factura, ND). Negative = pago / NC. */
  signed_amount: number;
  /** Absolute value, useful when rendering "Debe" / "Haber" columns. */
  gross_amount: number;
  channel_id: string;
  channel_name: string;
  channel_division: string;
  channel_is_fiscal: boolean;
  /** Running balance after this row (sorted oldest → newest by movement_date,
   *  then created_at). */
  balance: number;
  /** Per-document outstanding: only meaningful for invoice rows.
   *  imp_total minus the sum of issued receipt_allocations applied to it.
   *  Receipt rows return their "a cuenta" (total minus allocations).
   *  null when not applicable. */
  outstanding: number | null;
}

export interface ClientAccountResult {
  movements: AccountMovement[];
  /** Final running balance — last row's `balance`. Positive = cliente debe. */
  balance: number;
}

/**
 * Returns the chronological feed of comprobantes + recibos for a client
 * with a running balance computed in TS. The view filters by status
 * (`emitted` / `issued`) so cancelled / failed rows never appear.
 */
export async function getClientAccountAction(
  clientId: string,
): Promise<ActionResult<ClientAccountResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("v_client_account_movements")
    .select(
      "source_type, source_id, movement_date, created_at, kind, letter, punto_venta, numero, signed_amount, gross_amount, channel_id, channel_name, channel_division, channel_is_fiscal",
    )
    .eq("client_id", clientId)
    .order("movement_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("clients.account.list_failed", { clientId, error });
    return { ok: false, error: "No se pudo cargar la cuenta corriente." };
  }

  const rows = data ?? [];

  // Per-document outstanding: invoices show imp_total − Σ allocations
  // applied (from issued receipts only). Receipts show their "a cuenta"
  // (total − Σ allocations made by THIS receipt).
  const invoiceIds = rows
    .filter((r) => r.source_type === "invoice" && r.source_id)
    .map((r) => r.source_id!) as string[];
  const receiptIds = rows
    .filter((r) => r.source_type === "receipt" && r.source_id)
    .map((r) => r.source_id!) as string[];

  const appliedByInvoice = new Map<string, number>();
  const appliedByReceipt = new Map<string, number>();
  if (invoiceIds.length > 0 || receiptIds.length > 0) {
    const { data: allocs } = await supabase
      .from("receipt_allocations")
      .select(
        "invoice_id, receipt_id, amount_applied, receipts ( status )",
      )
      .in(
        "invoice_id",
        invoiceIds.length > 0 ? invoiceIds : ["00000000-0000-0000-0000-000000000000"],
      );

    for (const a of allocs ?? []) {
      const status = (
        a as unknown as { receipts: { status: string } | null }
      ).receipts?.status;
      if (status === "canceled") continue;
      const amt = Number(a.amount_applied);
      if (a.invoice_id) {
        appliedByInvoice.set(
          a.invoice_id,
          (appliedByInvoice.get(a.invoice_id) ?? 0) + amt,
        );
      }
    }

    if (receiptIds.length > 0) {
      const { data: receiptAllocs } = await supabase
        .from("receipt_allocations")
        .select("receipt_id, amount_applied")
        .in("receipt_id", receiptIds);
      for (const a of receiptAllocs ?? []) {
        const amt = Number(a.amount_applied);
        appliedByReceipt.set(
          a.receipt_id,
          (appliedByReceipt.get(a.receipt_id) ?? 0) + amt,
        );
      }
    }
  }
  let running = 0;
  const movements: AccountMovement[] = [];
  for (const row of rows) {
    if (
      row.source_type == null ||
      row.source_id == null ||
      row.movement_date == null ||
      row.created_at == null ||
      row.kind == null ||
      row.punto_venta == null ||
      row.numero == null ||
      row.signed_amount == null ||
      row.gross_amount == null ||
      row.channel_id == null ||
      row.channel_name == null ||
      row.channel_division == null ||
      row.channel_is_fiscal == null
    ) {
      logger.warn("clients.account.row_with_nulls", { clientId, row });
      continue;
    }
    const signed = Number(row.signed_amount);
    const gross = Number(row.gross_amount);
    running = Math.round((running + signed) * 100) / 100;
    let outstanding: number | null = null;
    if (row.source_type === "invoice" && row.kind !== "credit_note") {
      const applied = appliedByInvoice.get(row.source_id) ?? 0;
      outstanding = Math.max(0, Math.round((gross - applied) * 100) / 100);
    } else if (row.source_type === "receipt") {
      const applied = appliedByReceipt.get(row.source_id) ?? 0;
      outstanding = Math.max(0, Math.round((gross - applied) * 100) / 100);
    }
    movements.push({
      source_type: row.source_type as AccountMovementSourceType,
      source_id: row.source_id,
      movement_date: row.movement_date,
      created_at: row.created_at,
      kind: row.kind,
      letter: row.letter,
      punto_venta: row.punto_venta,
      numero: row.numero,
      signed_amount: signed,
      gross_amount: gross,
      channel_id: row.channel_id,
      channel_name: row.channel_name,
      channel_division: row.channel_division,
      channel_is_fiscal: row.channel_is_fiscal,
      balance: running,
      outstanding,
    });
  }

  return { ok: true, data: { movements, balance: running } };
}
