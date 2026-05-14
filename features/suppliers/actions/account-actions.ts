"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type SupplierAccountSourceType = "purchase_invoice" | "payment_order";

export interface SupplierAccountMovement {
  source_type: SupplierAccountSourceType;
  source_id: string;
  movement_date: string;
  created_at: string;
  /** 'factura' | 'nc' | 'nd' | 'payment_order' */
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
  /** Positive = nosotros debemos (factura, ND).
   *  Negative = pago nuestro o NC del proveedor. */
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

  const supabase = await createSupabaseClient();

  const CHUNK = 1000;
  const HARD_CAP = 50000;
  type Row = {
    source_type: string;
    source_id: string;
    movement_date: string;
    created_at: string;
    kind: string;
    letter: string | null;
    punto_venta: number;
    numero: number;
    signed_amount: number | string;
    gross_amount: number | string;
    channel_id: string;
    channel_name: string | null;
    channel_division: string | null;
    channel_is_fiscal: boolean | null;
  };
  const data: Row[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += CHUNK) {
    const { data: chunk, error } = await supabase
      .from("v_supplier_account_movements")
      .select(
        "source_type, source_id, movement_date, created_at, kind, letter, punto_venta, numero, signed_amount, gross_amount, channel_id, channel_name, channel_division, channel_is_fiscal",
      )
      .eq("supplier_id", supplierId)
      .order("movement_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + CHUNK - 1);
    if (error) {
      logger.error("suppliers.account.list_failed", { supplierId, error });
      return { ok: false, error: "No se pudo cargar la cuenta corriente." };
    }
    const got = (chunk ?? []) as Row[];
    data.push(...got);
    if (got.length < CHUNK) break;
  }

  // Per-document outstanding: factura/ND muestra imp_total − Σ allocations
  // de OPs issued. OP muestra "a cuenta" (total − Σ allocations propias).
  const piIds = data
    .filter((r) => r.source_type === "purchase_invoice")
    .map((r) => r.source_id);
  const opIds = data
    .filter((r) => r.source_type === "payment_order")
    .map((r) => r.source_id);

  const appliedByInvoice = new Map<string, number>();
  if (piIds.length > 0) {
    const { data: allocs, error: aErr } = await supabase
      .from("payment_order_allocations")
      .select(
        "purchase_invoice_id, amount_applied, payment_orders!inner ( status, supplier_id )",
      )
      .eq("payment_orders.supplier_id", supplierId);
    if (aErr) {
      logger.error("suppliers.account.allocations_failed", { error: aErr });
    }
    for (const a of allocs ?? []) {
      const status = (
        a as unknown as { payment_orders: { status: string } | null }
      ).payment_orders?.status;
      if (status !== "issued") continue;
      const prev = appliedByInvoice.get(a.purchase_invoice_id) ?? 0;
      appliedByInvoice.set(
        a.purchase_invoice_id,
        prev + Number(a.amount_applied),
      );
    }
  }

  const appliedByOP = new Map<string, number>();
  if (opIds.length > 0) {
    const { data: opAllocs, error: oErr } = await supabase
      .from("payment_order_allocations")
      .select("payment_order_id, amount_applied")
      .in("payment_order_id", opIds);
    if (oErr) {
      logger.error("suppliers.account.op_allocations_failed", { error: oErr });
    }
    for (const a of opAllocs ?? []) {
      const prev = appliedByOP.get(a.payment_order_id) ?? 0;
      appliedByOP.set(a.payment_order_id, prev + Number(a.amount_applied));
    }
  }

  let running = 0;
  const movements: SupplierAccountMovement[] = data.map((r) => {
    const signed = Number(r.signed_amount);
    running += signed;
    let outstanding: number | null = null;
    if (r.source_type === "purchase_invoice") {
      const total = Number(r.gross_amount);
      if (r.kind === "nc") {
        outstanding = null; // NCs no llevan saldo por sí solas
      } else {
        const applied = appliedByInvoice.get(r.source_id) ?? 0;
        outstanding = Math.max(0, total - applied);
      }
    } else if (r.source_type === "payment_order") {
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
      punto_venta: r.punto_venta,
      numero: r.numero,
      signed_amount: signed,
      gross_amount: Number(r.gross_amount),
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      channel_division: r.channel_division,
      channel_is_fiscal: r.channel_is_fiscal,
      balance: Math.round(running * 100) / 100,
      outstanding: outstanding,
    };
  });

  return {
    ok: true,
    data: { movements, balance: Math.round(running * 100) / 100 },
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

  // El view de aging trae solo numéricos por proveedor — joineamos con
  // suppliers para nombre/CUIT.
  const { data: agingRows, error } = await supabase
    .from("v_supplier_aging")
    .select(
      "supplier_id, bucket_0_30, bucket_30_60, bucket_60_90, bucket_90_plus, total_open, document_count, oldest_days, suppliers!inner(legal_name, cuit)",
    );

  if (error) {
    logger.error("suppliers.aging.list_failed", { error });
    return { ok: false, error: "No se pudo cargar el aging de proveedores." };
  }

  const summaries: SupplierAgingSummary[] = (agingRows ?? [])
    .filter((r): r is typeof r & { supplier_id: string } => r.supplier_id !== null)
    .map((r) => {
      const sup = (r as unknown as { suppliers: { legal_name: string; cuit: string } }).suppliers;
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
