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

import type { SupplierIdentityJoin } from "@/features/suppliers/schema";

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
  if (!userCan(ctx.roles, "suppliers:read")) {
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
  if (!ctx.roles.includes("owner")) {
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
  if (!ctx.roles.includes("owner")) {
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
  | "purchase_invoice"
  | "payment_order"
  | "opening_balance";

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
  /** Running balance (oldest → newest). > 0 = les debemos. */
  balance: number;
  /** Per-document outstanding: only for purchase_invoice rows.
   *  imp_total minus the sum of issued payment_order_allocations.
   *  Payment_order rows show their "a cuenta" (total − Σ allocations).
   *  null when not applicable. */
  outstanding: number | null;
}

export interface SupplierAccountResult {
  movements: SupplierAccountMovement[];
  /** Final running balance. Positive = les debemos al proveedor. */
  balance: number;
}

export async function getSupplierAccountAction(
  supplierId: string,
): Promise<ActionResult<SupplierAccountResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
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
  // PostgREST caps every response at `max_rows` (1000), so the feed and the
  // allocations are drained page by page (lib/supabase/paginate) with a total
  // order (movement_date + created_at can tie → source_type + source_id).
  // The three reads are independent → in parallel.
  const [movementsRes, allocsRes, openingAllocsRes] = await Promise.all([
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
    // the parent's supplier_id, not `.in(…)`, to stay under the URL cap). The
    // same rows give per-invoice "applied" (issued OPs only) and per-OP
    // "a cuenta", so no second `.in(payment_order_id, …)` query is needed.
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
    // Opening balance allocations: an invoice that received money from the
    // adjustment also reduces the aging/outstanding.
    paginateRange((from, to) =>
      supabase
        .from("supplier_opening_balance_allocations")
        .select("purchase_invoice_id, amount_applied")
        .eq("supplier_id", supplierId)
        .order("purchase_invoice_id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (movementsRes.error || allocsRes.error || openingAllocsRes.error) {
    logger.error("suppliers.account.list_failed", {
      userId: ctx.userId,
      supplierId,
      error: movementsRes.error ?? allocsRes.error ?? openingAllocsRes.error,
    });
    return { ok: false, error: "No se pudo cargar la cuenta corriente." };
  }
  const data = movementsRes.data as Row[];

  // Per-document outstanding: factura/ND shows imp_total − Σ allocations
  // from issued OPs − Σ opening allocations. An OP shows its "a cuenta"
  // (total − Σ its own allocations).
  const { appliedByDocument: appliedByInvoice, appliedByPayer: appliedByOP } =
    sumAllocations(
      allocsRes.data.map((a) => ({
        document_id: a.purchase_invoice_id,
        payer_id: a.payment_order_id,
        amount_applied: a.amount_applied,
        counts_for_document: readEmbeddedStatus(a.payment_orders) === "issued",
      })),
      openingAllocsRes.data.map((a) => ({
        document_id: a.purchase_invoice_id,
        amount_applied: a.amount_applied,
      })),
    );

  // Re-sort: rows arrive ordered by movement_date+created_at (asc). Opening
  // balance rows have movement_date = opening_date — they sit naturally where
  // they belong chronologically. Good.

  let running = 0;
  const movements: SupplierAccountMovement[] = data.map((r) => {
    const signed = Number(r.signed_amount);
    running += signed;
    let outstanding: number | null = null;
    if (r.source_type === "purchase_invoice" && r.source_id) {
      const total = Number(r.gross_amount);
      if (r.kind === "nc") {
        outstanding = null;
      } else {
        const applied = appliedByInvoice.get(r.source_id) ?? 0;
        outstanding = Math.max(0, total - applied);
      }
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

  return {
    ok: true,
    data: { movements, balance: round2(running) },
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

export type SupplierAgingSummary = {
  supplier_id: string;
  supplier_legal_name: string;
  supplier_cuit: string;
  bucket_0_30: number;
  bucket_30_60: number;
  bucket_60_90: number;
  bucket_90_plus: number;
  total_open: number;
  document_count: number;
  oldest_days: number;
};

export async function getSupplierAgingAction(): Promise<
  ActionResult<SupplierAgingSummary[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "suppliers:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = await createSupabaseClient();

  // The aging view returns only numerics per supplier — we join with
  // suppliers for name/CUIT.
  // Drained past max_rows (1000) — one row per supplier with open documents.
  const { data: agingRows, error } = await paginateRange((from, to) =>
    supabase
      .from("v_supplier_aging")
      .select(
        "supplier_id, bucket_0_30, bucket_30_60, bucket_60_90, bucket_90_plus, total_open, document_count, oldest_days, suppliers!inner(legal_name, cuit)",
      )
      .order("supplier_id", { ascending: true })
      .range(from, to),
  );

  if (error) {
    logger.error("suppliers.aging.list_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudo cargar el aging de proveedores." };
  }

  const summaries: SupplierAgingSummary[] = (agingRows ?? [])
    .filter(
      (r): r is typeof r & { supplier_id: string } => r.supplier_id !== null,
    )
    .map((r) => {
      const sup = (r as unknown as SupplierIdentityJoin).suppliers;
      return {
        supplier_id: r.supplier_id,
        supplier_legal_name: sup.legal_name,
        supplier_cuit: sup.cuit,
        bucket_0_30: Number(r.bucket_0_30),
        bucket_30_60: Number(r.bucket_30_60),
        bucket_60_90: Number(r.bucket_60_90),
        bucket_90_plus: Number(r.bucket_90_plus),
        total_open: Number(r.total_open),
        document_count: Number(r.document_count),
        oldest_days: Number(r.oldest_days),
      };
    });

  return { ok: true, data: summaries };
}
