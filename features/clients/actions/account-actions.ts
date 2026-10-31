"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";
import { readEmbeddedStatus, sumAllocations } from "@/lib/allocations";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  IsoDateSchema,
  NonNegativeAmountSchema,
  NotesSchema,
  UuidSchema,
} from "@/lib/validation/common";

const SetOpeningInput = z.object({
  client_id: UuidSchema,
  opening_date: IsoDateSchema,
  target_balance: NonNegativeAmountSchema,
  notes: NotesSchema,
});

/** `rejected_check`: a check of an issued receipt that bounced; the client
 *  owes it again (D11). Numbered with the receipt that brought it. */
export type AccountMovementSourceType =
  "invoice" | "receipt" | "opening_balance" | "rejected_check";

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
  /** Positive = the client owes (invoice, ND, opening_balance).
   *  Negative = payment / NC. */
  signed_amount: number;
  /** Absolute value, useful when rendering "Debe" / "Haber" columns. */
  gross_amount: number;
  /** null for opening_balance — does not belong to any channel. */
  channel_id: string | null;
  channel_name: string | null;
  channel_division: string | null;
  channel_is_fiscal: boolean | null;
  /** Running balance after this row (sorted oldest → newest by movement_date,
   *  then created_at). `null` under a fiscal/internal scope: there is no
   *  running balance per scope, only the scope's aging total. */
  balance: number | null;
  /** Per-document outstanding: for factura/ND rows, the open amount of
   *  v_aging_documents (imp_total − issued receipts − opening balance − NCs),
   *  the same figure as the aging. Receipt rows return their "a cuenta"
   *  (total minus allocations). null when not applicable. */
  outstanding: number | null;
}

export interface ClientAccountResult {
  movements: AccountMovement[];
  /** "Todos": the final running balance (last row's `balance`). Under a
   *  scope: the scope's aging total minus its receipts' unapplied amounts
   *  ("a cuenta"). Positive = client owes. */
  balance: number;
  /** False under a scope: rows carry no running balance. */
  runningBalance: boolean;
}

/**
 * Returns the chronological feed of comprobantes + recibos for a client
 * with a running balance computed in TS. The view filters by status
 * (`emitted` / `issued`) so cancelled / failed rows never appear.
 *
 * With `isFiscal` (D6) only that scope's movements are listed, the opening
 * balance (no channel) stays as an informative row, and the single balance is
 * the scope's aging total net of its receipts' unapplied amounts.
 */
export async function getClientAccountAction(
  clientId: string,
  input?: { isFiscal?: boolean | null },
): Promise<ActionResult<ClientAccountResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }
  const idParsed = UuidSchema.safeParse(clientId);
  if (!idParsed.success) {
    return { ok: false, error: "ID de cliente inválido." };
  }
  clientId = idParsed.data;

  const supabase = await createSupabaseClient();

  // PostgREST caps every response at `max_rows` (1000), so the feed, the
  // allocations and the open documents are drained page by page
  // (lib/supabase/paginate). Each drain needs a total order: movement_date +
  // created_at alone can tie, so source_type + source_id close it. The three
  // reads are independent.
  const [movementsRes, allocsRes, openRes] = await Promise.all([
    paginateRange((from, to) =>
      supabase
        .from("v_client_account_movements")
        .select(
          "source_type, source_id, movement_date, created_at, kind, letter, punto_venta, numero, signed_amount, gross_amount, channel_id, channel_name, channel_division, channel_is_fiscal",
        )
        .eq("client_id", clientId)
        .order("movement_date", { ascending: true })
        .order("created_at", { ascending: true })
        .order("source_type", { ascending: true })
        .order("source_id", { ascending: true, nullsFirst: true })
        .range(from, to),
    ),
    // Every allocation made by this client's receipts, for each receipt's
    // "a cuenta". Filtering by the receipt's client_id (not `.in(…)`) avoids
    // PostgREST's URL length cap; !inner narrows to the parent.
    paginateRange((from, to) =>
      supabase
        .from("receipt_allocations")
        .select(
          "id, invoice_id, receipt_id, amount_applied, receipts!inner ( status, client_id )",
        )
        .eq("receipts.client_id", clientId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // Open factura/ND of the client (open_amount > 0): one formula with the
    // aging; a document missing here owes nothing.
    paginateRange((from, to) =>
      supabase
        .from("v_aging_documents")
        .select("invoice_id, open_amount, channel_is_fiscal")
        .eq("client_id", clientId)
        .order("invoice_id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (movementsRes.error || allocsRes.error || openRes.error) {
    logger.error("clients.account.list_failed", {
      userId: ctx.userId,
      clientId,
      error: movementsRes.error ?? allocsRes.error ?? openRes.error,
    });
    return { ok: false, error: "No se pudo cargar la cuenta corriente." };
  }

  // Opening balance behaves like an adjustment transaction: on its date
  // the balance "jumps" to target_balance. Effective signed_amount = target -
  // balance_computed_just_before. To keep the ordering clear, on a date tie
  // the opening row goes last (after the invoices/receipts of that same
  // day) — so the adjustment reconciles the full day.
  const rows = movementsRes.data.slice().sort((a, b) => {
    const dateA = a.movement_date ?? "";
    const dateB = b.movement_date ?? "";
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    const aOpen = a.source_type === "opening_balance" ? 1 : 0;
    const bOpen = b.source_type === "opening_balance" ? 1 : 0;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });

  // Receipts show their "a cuenta" (total − Σ allocations made by THIS
  // receipt); invoices their open amount from v_aging_documents.
  const { appliedByPayer: appliedByReceipt } = sumAllocations(
    allocsRes.data.map((a) => ({
      document_id: a.invoice_id,
      payer_id: a.receipt_id,
      amount_applied: a.amount_applied,
      counts_for_document: readEmbeddedStatus(a.receipts) !== "canceled",
    })),
    [],
  );
  const openByInvoice = new Map<string, number>();
  for (const d of openRes.data) {
    if (d.invoice_id) openByInvoice.set(d.invoice_id, Number(d.open_amount));
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
      logger.warn("clients.account.row_with_nulls", {
        userId: ctx.userId,
        clientId,
        row,
      });
      continue;
    }
    let signed = Number(row.signed_amount);
    let gross = Number(row.gross_amount);
    if (row.source_type === "opening_balance") {
      // The balance "jumps" to the target. Effective signed = target - running.
      const target = Number(row.signed_amount); // the view leaves target_balance here
      signed = round2(target - running);
      gross = Math.abs(signed);
    }
    running = round2(running + signed);
    let outstanding: number | null = null;
    if (row.source_type === "invoice" && row.source_id && row.kind !== "nc") {
      outstanding = round2(openByInvoice.get(row.source_id) ?? 0);
    } else if (row.source_type === "receipt" && row.source_id) {
      const applied = appliedByReceipt.get(row.source_id) ?? 0;
      outstanding = Math.max(0, round2(gross - applied));
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

  const isFiscal = input?.isFiscal ?? null;
  if (isFiscal === null) {
    return {
      ok: true,
      data: { movements, balance: running, runningBalance: true },
    };
  }

  // The scope's balance: what its open documents owe minus what its receipts
  // paid without applying ("a cuenta"), so a payment on account lowers it.
  const scopeMovements = movements.filter(
    (m) => m.channel_is_fiscal === isFiscal,
  );
  const scopeOpen = openRes.data
    .filter((d) => d.channel_is_fiscal === isFiscal)
    .reduce((sum, d) => sum + Number(d.open_amount ?? 0), 0);
  const scopeOnAccount = scopeMovements
    .filter((m) => m.source_type === "receipt")
    .reduce((sum, m) => sum + (m.outstanding ?? 0), 0);

  // The opening balance has no channel: shown as its target, informative only.
  const openingTarget = Number(
    rows.find((r) => r.source_type === "opening_balance")?.signed_amount ?? 0,
  );
  const scoped = movements.filter(
    (m) =>
      m.channel_is_fiscal === isFiscal || m.source_type === "opening_balance",
  );
  // Aging is per invoice and a bounced check reopens none, so its debt is
  // added on top of the scope's open documents.
  const rejectedChecks = scoped
    .filter((m) => m.source_type === "rejected_check")
    .reduce((sum, m) => sum + m.signed_amount, 0);
  return {
    ok: true,
    data: {
      movements: scoped.map((m) =>
        m.source_type === "opening_balance"
          ? {
              ...m,
              signed_amount: openingTarget,
              gross_amount: Math.abs(openingTarget),
              balance: null,
            }
          : { ...m, balance: null },
      ),
      balance: round2(scopeOpen - scopeOnAccount + rejectedChecks),
      runningBalance: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Opening balance
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
  if (!userCan(ctx.access, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver clientes." };
  }
  const idParsed = UuidSchema.safeParse(clientId);
  if (!idParsed.success) {
    return { ok: false, error: "ID de cliente inválido." };
  }
  clientId = idParsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("client_opening_balances")
    .select(
      "client_id, opening_date, target_balance, total_settled, notes, created_at, updated_at",
    )
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    logger.error("clients.opening.read_failed", {
      userId: ctx.userId,
      clientId,
      error,
    });
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
 * Sets (or overwrites) the client's opening balance. Atomic: the RPC
 * deletes the previous opening + its allocations and recreates from scratch,
 * applying FIFO from the oldest invoice.
 */
export async function setClientOpeningBalanceAction(input: {
  client_id: string;
  opening_date: string; // YYYY-MM-DD
  target_balance: number;
  notes?: string | null;
}): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  // The balance adjustment rewrites the client's aging — owner only.
  if (!userCan(ctx.access, "opening_balances:write")) {
    return {
      ok: false,
      error: "No tenés permiso para ajustar saldos de cliente.",
    };
  }
  const parsed = SetOpeningInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input inválido.",
    };
  }
  input = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("apply_client_opening_balance", {
    p_client_id: input.client_id,
    p_opening_date: input.opening_date,
    p_target_balance: input.target_balance,
    p_notes: input.notes ?? undefined,
  });
  if (error) {
    logger.error("clients.opening.apply_failed", {
      userId: ctx.userId,
      clientId: input.client_id,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo aplicar el saldo de apertura.",
    };
  }
  return { ok: true, data: undefined };
}

export async function clearClientOpeningBalanceAction(
  clientId: string,
): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "opening_balances:write")) {
    return {
      ok: false,
      error: "Solo el owner puede borrar el ajuste de saldo.",
    };
  }
  const idParsed = UuidSchema.safeParse(clientId);
  if (!idParsed.success) {
    return { ok: false, error: "ID de cliente inválido." };
  }
  clientId = idParsed.data;
  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("clear_client_opening_balance", {
    p_client_id: clientId,
  });
  if (error) {
    logger.error("clients.opening.clear_failed", {
      userId: ctx.userId,
      clientId,
      error,
    });
    return { ok: false, error: "No se pudo borrar el saldo de apertura." };
  }
  return { ok: true, data: undefined };
}
