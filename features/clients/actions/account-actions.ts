"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type AccountMovementSourceType =
  | "invoice"
  | "receipt"
  | "opening_balance";

export interface AccountMovement {
  source_type: AccountMovementSourceType;
  /** null for opening_balance rows — there is no underlying entity row. */
  source_id: string | null;
  movement_date: string;
  created_at: string;
  /** comprobante kind ('factura' | 'nc' | 'nd'), 'recibo', or 'opening_balance' */
  kind: string;
  letter: string | null;
  /** null for opening_balance — no POS associated. */
  punto_venta: number | null;
  /** null for opening_balance — no correlativo associated. */
  numero: number | null;
  /** Positive = el cliente debe (factura, ND, opening_balance).
   *  Negative = pago / NC. */
  signed_amount: number;
  /** Absolute value, useful when rendering "Debe" / "Haber" columns. */
  gross_amount: number;
  /** null for opening_balance — does not belong to any channel. */
  channel_id: string | null;
  channel_name: string | null;
  channel_division: string | null;
  channel_is_fiscal: boolean | null;
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

  // PostgREST tiene un cap de `db.max_rows` (default 1000) que aplica
  // aunque pidas más con `.range()`. Chunkeamos en pedidos de 1000 hasta
  // vaciar el set. Cap defensivo de 50000 movimientos por cliente.
  const CHUNK = 1000;
  const HARD_CAP = 50000;
  type MovementRow = {
    source_type: string | null;
    source_id: string | null;
    movement_date: string | null;
    created_at: string | null;
    kind: string | null;
    letter: string | null;
    punto_venta: number | null;
    numero: number | null;
    signed_amount: number | string | null;
    gross_amount: number | string | null;
    channel_id: string | null;
    channel_name: string | null;
    channel_division: string | null;
    channel_is_fiscal: boolean | null;
  };
  const data: MovementRow[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += CHUNK) {
    const { data: chunk, error } = await supabase
      .from("v_client_account_movements")
      .select(
        "source_type, source_id, movement_date, created_at, kind, letter, punto_venta, numero, signed_amount, gross_amount, channel_id, channel_name, channel_division, channel_is_fiscal",
      )
      .eq("client_id", clientId)
      .order("movement_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + CHUNK - 1);
    if (error) {
      logger.error("clients.account.list_failed", { clientId, error });
      return { ok: false, error: "No se pudo cargar la cuenta corriente." };
    }
    const got = (chunk ?? []) as MovementRow[];
    data.push(...got);
    if (got.length < CHUNK) break;
  }

  // Opening balance se comporta como una transaction de ajuste: en su fecha
  // el saldo "salta" al target_balance. signed_amount efectivo = target -
  // saldo_calculado_justo_antes. Para que el orden quede claro, en empate
  // de fecha la opening row va al final (después de las facturas/recibos
  // de ese mismo día) — así el ajuste reconcilia el día completo.
  const rows = (data ?? []).slice().sort((a, b) => {
    const dateA = a.movement_date ?? "";
    const dateB = b.movement_date ?? "";
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    const aOpen = a.source_type === "opening_balance" ? 1 : 0;
    const bOpen = b.source_type === "opening_balance" ? 1 : 0;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });

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

    // También sumar lo imputado por el ajuste de saldo, así las facturas
    // que el opening marcó como saldadas muestran el badge "Pagada" o
    // "Parcial" en el cuenta corriente.
    if (invoiceIds.length > 0) {
      const { data: openingAllocs } = await supabase
        .from("client_opening_balance_allocations")
        .select("invoice_id, amount_applied")
        .in("invoice_id", invoiceIds);
      for (const a of openingAllocs ?? []) {
        const amt = Number(a.amount_applied);
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
    // Validate only the fields that are required for ALL source_types.
    // opening_balance rows legitimately have null source_id, punto_venta,
    // numero, channel_*, etc.
    if (
      row.source_type == null ||
      row.movement_date == null ||
      row.created_at == null ||
      row.kind == null ||
      row.signed_amount == null ||
      row.gross_amount == null
    ) {
      logger.warn("clients.account.row_with_nulls", { clientId, row });
      continue;
    }
    let signed = Number(row.signed_amount);
    let gross = Number(row.gross_amount);
    if (row.source_type === "opening_balance") {
      // El saldo "salta" al target. signed efectivo = target - running.
      const target = Number(row.signed_amount); // la vista deja target_balance acá
      signed = Math.round((target - running) * 100) / 100;
      gross = Math.abs(signed);
    }
    running = Math.round((running + signed) * 100) / 100;
    let outstanding: number | null = null;
    if (row.source_type === "invoice" && row.source_id && row.kind !== "credit_note") {
      const applied = appliedByInvoice.get(row.source_id) ?? 0;
      outstanding = Math.max(0, Math.round((gross - applied) * 100) / 100);
    } else if (row.source_type === "receipt" && row.source_id) {
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

// ---------------------------------------------------------------------------
// Opening balance (saldo de apertura)
// ---------------------------------------------------------------------------

export interface ClientOpeningBalance {
  client_id: string;
  opening_date: string;
  target_balance: number;
  total_settled: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function getClientOpeningBalanceAction(
  clientId: string,
): Promise<ActionResult<ClientOpeningBalance | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("client_opening_balances")
    .select(
      "client_id, opening_date, target_balance, total_settled, notes, created_at, updated_at",
    )
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    logger.error("clients.opening.read_failed", { clientId, error });
    return { ok: false, error: "No se pudo cargar el saldo de apertura." };
  }
  if (!data) return { ok: true, data: null };
  return {
    ok: true,
    data: {
      client_id: data.client_id,
      opening_date: data.opening_date,
      target_balance: Number(data.target_balance),
      total_settled: Number(data.total_settled),
      notes: data.notes,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
  };
}

/**
 * Fija (o sobrescribe) el saldo de apertura del cliente. Atómico: el RPC
 * borra el opening anterior + sus allocations y recrea desde cero
 * imputando FIFO desde la factura más vieja.
 */
export async function setClientOpeningBalanceAction(input: {
  client_id: string;
  opening_date: string; // YYYY-MM-DD
  target_balance: number;
  notes?: string | null;
}): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:write")) {
    return {
      ok: false,
      error: "No tenés permiso para ajustar saldos de cliente.",
    };
  }
  if (!input.client_id) return { ok: false, error: "Cliente requerido." };
  if (input.target_balance < 0)
    return { ok: false, error: "El saldo no puede ser negativo." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("apply_client_opening_balance", {
    p_client_id: input.client_id,
    p_opening_date: input.opening_date,
    p_target_balance: input.target_balance,
    p_notes: input.notes ?? undefined,
  });
  if (error) {
    logger.error("clients.opening.apply_failed", {
      clientId: input.client_id,
      error,
    });
    return {
      ok: false,
      error:
        error.message ?? "No se pudo aplicar el saldo de apertura.",
    };
  }
  return { ok: true, data: undefined };
}

export async function clearClientOpeningBalanceAction(
  clientId: string,
): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:write")) {
    return { ok: false, error: "No tenés permiso para borrar saldos." };
  }
  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("clear_client_opening_balance", {
    p_client_id: clientId,
  });
  if (error) {
    logger.error("clients.opening.clear_failed", { clientId, error });
    return { ok: false, error: "No se pudo borrar el saldo de apertura." };
  }
  return { ok: true, data: undefined };
}
