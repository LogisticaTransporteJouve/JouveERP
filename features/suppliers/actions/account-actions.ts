"use server";

import type { ActionResult } from "@/lib/query/run-action";
import { z } from "zod";

import {
  AGING_VIEW_AMOUNT_COLUMNS,
  aggregateSupplierAging,
  type AgingReport,
} from "@/lib/aging";
import { requireUserContext } from "@/lib/auth/context";
import {
  SUPPLIER_AGING_PERMISSIONS,
  userCan,
  userCanAll,
} from "@/lib/auth/permissions";
import { round2 } from "@/lib/format";
import { fetchLatestUsdRate } from "@/lib/fx";
import { logger } from "@/lib/logger";
import { readEmbeddedStatus, sumAllocations } from "@/lib/allocations";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  IsoDateSchema,
  NonNegativeAmountSchema,
  NotesSchema,
  UuidSchema,
} from "@/lib/validation/common";

const SetSupplierOpeningInput = z.object({
  supplier_id: UuidSchema,
  opening_date: IsoDateSchema,
  target_balance: NonNegativeAmountSchema,
  notes: NotesSchema,
});

export interface SupplierOpeningBalance {
  supplier_id: string;
  opening_date: string;
  target_balance: number;
  total_settled: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function getSupplierOpeningBalanceAction(
  supplierId: string,
): Promise<ActionResult<SupplierOpeningBalance | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso para ver proveedores." };
  }
  const idParsed = UuidSchema.safeParse(supplierId);
  if (!idParsed.success) {
    return { ok: false, error: "ID de proveedor inválido." };
  }
  supplierId = idParsed.data;
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("supplier_opening_balances")
    .select(
      "supplier_id, opening_date, target_balance, total_settled, notes, created_at, updated_at",
    )
    .eq("supplier_id", supplierId)
    .maybeSingle();
  if (error) {
    logger.error("suppliers.opening.read_failed", {
      userId: ctx.userId,
      supplierId,
      error,
    });
    return { ok: false, error: "No se pudo cargar el saldo de apertura." };
  }
  if (!data) return { ok: true, data: null };
  return {
    ok: true,
    data: {
      supplier_id: data.supplier_id,
      opening_date: data.opening_date,
      target_balance: Number(data.target_balance),
      total_settled: Number(data.total_settled),
      notes: data.notes,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
  };
}

export async function setSupplierOpeningBalanceAction(input: {
  supplier_id: string;
  opening_date: string;
  target_balance: number;
  notes?: string | null;
}): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "opening_balances:write")) {
    return {
      ok: false,
      error: "Solo el owner puede ajustar saldos de proveedor.",
    };
  }
  const parsed = SetSupplierOpeningInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Input inválido.",
    };
  }
  input = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("apply_supplier_opening_balance", {
    p_supplier_id: input.supplier_id,
    p_opening_date: input.opening_date,
    p_target_balance: input.target_balance,
    p_notes: input.notes ?? undefined,
  });
  if (error) {
    logger.error("suppliers.opening.apply_failed", {
      userId: ctx.userId,
      supplierId: input.supplier_id,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo aplicar el saldo de apertura.",
    };
  }
  return { ok: true, data: undefined };
}

export async function clearSupplierOpeningBalanceAction(
  supplierId: string,
): Promise<ActionResult<void>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "opening_balances:write")) {
    return {
      ok: false,
      error: "Solo el owner puede borrar el ajuste de saldo.",
    };
  }
  const idParsed = UuidSchema.safeParse(supplierId);
  if (!idParsed.success) {
    return { ok: false, error: "ID de proveedor inválido." };
  }
  supplierId = idParsed.data;
  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("clear_supplier_opening_balance", {
    p_supplier_id: supplierId,
  });
  if (error) {
    logger.error("suppliers.opening.clear_failed", {
      userId: ctx.userId,
      supplierId,
      error,
    });
    return { ok: false, error: "No se pudo borrar el saldo de apertura." };
  }
  return { ok: true, data: undefined };
}

export type SupplierAccountSourceType =
  "purchase_invoice" | "payment_order" | "opening_balance";

export interface SupplierAccountMovement {
  source_type: SupplierAccountSourceType;
  source_id: string | null;
  movement_date: string;
  created_at: string;
  /** 'factura' | 'nc' | 'nd' | 'payment_order' | 'opening_balance' */
  kind: string;
  letter: string | null;
  /** 0 when it's an opening_balance (not applicable). */
  punto_venta: number;
  numero: number;
  /** Positive = we owe (factura, ND, opening).
   *  Negative = our payment or a supplier NC. */
  signed_amount: number;
  gross_amount: number;
  channel_id: string;
  channel_name: string | null;
  channel_division: string | null;
  channel_is_fiscal: boolean | null;
  /** Running balance (oldest → newest). > 0 = les debemos. `null` under a
   *  fiscal/internal scope (only the scope's aging total exists). */
  balance: number | null;
  /** Per-document outstanding: for factura/ND rows, open_amount of
   *  v_purchase_invoice_open (imp_total − issued OPs − NCs − opening
   *  balance), the same figure as the aging and the OP guard. Payment_order
   *  rows show their "a cuenta" (total − Σ allocations). null when not
   *  applicable. */
  outstanding: number | null;
}

export interface SupplierAccountResult {
  movements: SupplierAccountMovement[];
  /** "Todos": the final running balance. Under a scope: the scope's open
   *  documents minus its OPs' unapplied amounts and its NCs without origin.
   *  Positive = les debemos. */
  balance: number;
  /** False under a scope: rows carry no running balance. */
  runningBalance: boolean;
}

/** With `isFiscal` (D6): only that scope's movements, the opening balance as
 *  an informative row and the scope's open documents net of its unapplied
 *  credits as the single balance. */
export async function getSupplierAccountAction(
  supplierId: string,
  input?: { isFiscal?: boolean | null },
): Promise<ActionResult<SupplierAccountResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso para ver proveedores." };
  }
  const idParsed = UuidSchema.safeParse(supplierId);
  if (!idParsed.success) {
    return { ok: false, error: "ID de proveedor inválido." };
  }
  supplierId = idParsed.data;

  const supabase = await createSupabaseClient();

  type Row = {
    source_type: string;
    source_id: string | null;
    movement_date: string;
    created_at: string;
    kind: string;
    letter: string | null;
    punto_venta: number | null;
    numero: number | null;
    signed_amount: number | string;
    gross_amount: number | string;
    channel_id: string | null;
    channel_name: string | null;
    channel_division: string | null;
    channel_is_fiscal: boolean | null;
  };
  // PostgREST caps every response at `max_rows` (1000), so the feed, the
  // allocations and the open amounts are drained page by page
  // (lib/supabase/paginate) with a total order (movement_date + created_at can
  // tie → source_type + source_id). The three reads are independent.
  const [movementsRes, allocsRes, openRes] = await Promise.all([
    paginateRange((from, to) =>
      supabase
        .from("v_supplier_account_movements")
        .select(
          "source_type, source_id, movement_date, created_at, kind, letter, punto_venta, numero, signed_amount, gross_amount, channel_id, channel_name, channel_division, channel_is_fiscal",
        )
        .eq("supplier_id", supplierId)
        .order("movement_date", { ascending: true })
        .order("created_at", { ascending: true })
        .order("source_type", { ascending: true })
        .order("source_id", { ascending: true, nullsFirst: true })
        .range(from, to),
    ),
    // Every allocation made by this supplier's payment orders (filtered via
    // the parent's supplier_id, not `.in(…)`, to stay under the URL cap), for
    // each OP's "a cuenta".
    paginateRange((from, to) =>
      supabase
        .from("payment_order_allocations")
        .select(
          "id, purchase_invoice_id, payment_order_id, amount_applied, payment_orders!inner ( status, supplier_id )",
        )
        .eq("payment_orders.supplier_id", supplierId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("v_purchase_invoice_open")
        .select("purchase_invoice_id, open_amount, invoice_origin_id")
        .eq("supplier_id", supplierId)
        .order("purchase_invoice_id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (movementsRes.error || allocsRes.error || openRes.error) {
    logger.error("suppliers.account.list_failed", {
      userId: ctx.userId,
      supplierId,
      error: movementsRes.error ?? allocsRes.error ?? openRes.error,
    });
    return { ok: false, error: "No se pudo cargar la cuenta corriente." };
  }
  const data = movementsRes.data as Row[];

  // An OP shows its "a cuenta" (total − Σ its own allocations); a factura/ND
  // its open amount.
  const { appliedByPayer: appliedByOP } = sumAllocations(
    allocsRes.data.map((a) => ({
      document_id: a.purchase_invoice_id,
      payer_id: a.payment_order_id,
      amount_applied: a.amount_applied,
      counts_for_document: readEmbeddedStatus(a.payment_orders) === "issued",
    })),
    [],
  );
  const openByInvoice = new Map<string, number>();
  const unlinkedNc = new Set<string>();
  for (const o of openRes.data) {
    if (o.purchase_invoice_id === null) continue;
    openByInvoice.set(o.purchase_invoice_id, Number(o.open_amount ?? 0));
    if (o.invoice_origin_id === null) unlinkedNc.add(o.purchase_invoice_id);
  }

  // Re-sort: rows arrive ordered by movement_date+created_at (asc). Opening
  // balance rows have movement_date = opening_date — they sit naturally where
  // they belong chronologically. Good.

  let running = 0;
  const movements: SupplierAccountMovement[] = data.map((r) => {
    const signed = Number(r.signed_amount);
    running += signed;
    let outstanding: number | null = null;
    if (
      r.source_type === "purchase_invoice" &&
      r.source_id &&
      r.kind !== "nc"
    ) {
      outstanding = round2(Math.max(0, openByInvoice.get(r.source_id) ?? 0));
    } else if (r.source_type === "payment_order" && r.source_id) {
      const total = Number(r.gross_amount);
      const applied = appliedByOP.get(r.source_id) ?? 0;
      outstanding = Math.max(0, total - applied);
    }
    return {
      source_type: r.source_type as SupplierAccountSourceType,
      source_id: r.source_id,
      movement_date: r.movement_date,
      created_at: r.created_at,
      kind: r.kind,
      letter: r.letter,
      punto_venta: r.punto_venta ?? 0,
      numero: r.numero ?? 0,
      signed_amount: signed,
      gross_amount: Number(r.gross_amount),
      channel_id: r.channel_id ?? "",
      channel_name: r.channel_name,
      channel_division: r.channel_division,
      channel_is_fiscal: r.channel_is_fiscal,
      balance: round2(running),
      outstanding: outstanding,
    };
  });

  const isFiscal = input?.isFiscal ?? null;
  if (isFiscal === null) {
    return {
      ok: true,
      data: { movements, balance: round2(running), runningBalance: true },
    };
  }

  // The scope's balance: its open factura/ND minus what its OPs paid without
  // applying and its NCs without origin (credits that reduce no document).
  let scopeBalance = 0;
  for (const m of movements) {
    if (m.channel_is_fiscal !== isFiscal) continue;
    if (m.source_type === "payment_order") {
      scopeBalance -= m.outstanding ?? 0;
    } else if (m.source_type === "purchase_invoice" && m.source_id) {
      if (m.kind !== "nc") scopeBalance += m.outstanding ?? 0;
      else if (unlinkedNc.has(m.source_id)) scopeBalance -= m.gross_amount;
    }
  }

  return {
    ok: true,
    data: {
      movements: movements
        .filter(
          (m) =>
            m.channel_is_fiscal === isFiscal ||
            m.source_type === "opening_balance",
        )
        .map((m) => ({ ...m, balance: null })),
      balance: round2(scopeBalance),
      runningBalance: false,
    },
  };
}

export type SupplierAgingDocument = {
  purchase_invoice_id: string;
  supplier_id: string;
  fecha: string;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
  imp_total: number;
  amount_applied: number;
  open_amount: number;
  days_overdue: number;
  bucket: "0_30" | "30_60" | "60_90" | "90_plus";
  channel_id: string;
  channel_name: string | null;
  channel_is_fiscal: boolean;
};

const SUPPLIER_AGING_SELECT = `supplier_id, ${AGING_VIEW_AMOUNT_COLUMNS}, suppliers!inner(legal_name, cuit)`;

// `isFiscal` null reads every channel (v_supplier_aging); a boolean reads that
// scope only (v_supplier_aging_by_scope, one row per supplier).
export async function getSupplierAgingAction(input?: {
  isFiscal?: boolean | null;
}): Promise<ActionResult<AgingReport>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, SUPPLIER_AGING_PERMISSIONS)) {
    return { ok: false, error: "No tenés permiso." };
  }

  const isFiscal = input?.isFiscal ?? null;
  const supabase = await createSupabaseClient();

  // Drained past max_rows (1000) — one row per supplier with open documents.
  const [{ data: agingRows, error }, usdRate] = await Promise.all([
    isFiscal === null
      ? paginateRange((from, to) =>
          supabase
            .from("v_supplier_aging")
            .select(SUPPLIER_AGING_SELECT)
            .order("supplier_id", { ascending: true })
            .range(from, to),
        )
      : paginateRange((from, to) =>
          applyFiscalFilter(
            supabase
              .from("v_supplier_aging_by_scope")
              .select(SUPPLIER_AGING_SELECT),
            isFiscal,
          )
            .order("supplier_id", { ascending: true })
            .range(from, to),
        ),
    fetchLatestUsdRate(supabase),
  ]);

  if (error) {
    logger.error("suppliers.aging.list_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cargar el aging de proveedores." };
  }

  return { ok: true, data: aggregateSupplierAging(agingRows, usdRate) };
}
