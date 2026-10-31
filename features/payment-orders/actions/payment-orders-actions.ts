"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { round2 } from "@/lib/format";
import { allocateFifo, readEmbeddedStatus } from "@/lib/allocations";
import { paymentCurrencyOf } from "@/lib/fx";
import { logger } from "@/lib/logger";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import type {
  SupplierIdentityJoin,
  SupplierListLegalJoin,
} from "@/features/suppliers/schema";

import {
  PaymentOrderCancelSchema,
  PaymentOrderCreateSchema,
  PaymentOrderUpdateSchema,
  isPaymentOrderCurrency,
  isPaymentOrderStatus,
  type PaymentLineInput,
  type PaymentOrder,
  type PaymentOrderAllocation,
  type PaymentOrderPaymentLine,
} from "../schema";

function narrowPaymentOrder(row: {
  status: string;
  currency: string;
  [key: string]: unknown;
}): PaymentOrder | null {
  if (!isPaymentOrderStatus(row.status)) return null;
  if (!isPaymentOrderCurrency(row.currency)) return null;
  return row as PaymentOrder;
}

const COLUMNS =
  "id, channel_id, punto_venta, numero, supplier_id, payment_date, total_amount, currency, notes, status, canceled_at, canceled_by, created_by, created_at, updated_at";

function serializePaymentLine(line: PaymentLineInput) {
  if (line.line_kind === "endorse_check") {
    return {
      line_kind: "endorse_check",
      endorsed_check_id: line.endorsed_check_id,
      amount: line.amount,
      reference: line.reference ?? null,
    };
  }
  if (line.line_kind === "issue_check") {
    return {
      line_kind: "issue_check",
      account_id: line.account_id,
      amount: line.amount,
      reference: line.reference ?? null,
      issued_check: {
        kind: line.issued_check.kind,
        check_number: line.issued_check.check_number,
        bank_name: line.issued_check.bank_name,
        due_date: line.issued_check.due_date,
        issue_date: line.issued_check.issue_date ?? null,
        beneficiary_name: line.issued_check.beneficiary_name ?? null,
        beneficiary_cuit: line.issued_check.beneficiary_cuit ?? null,
        notes: line.issued_check.notes ?? null,
      },
    };
  }
  return {
    line_kind: "account",
    account_id: line.account_id,
    amount: line.amount,
    reference: line.reference ?? null,
  };
}

export async function listPaymentOrdersAction(input?: {
  limit?: number;
  /** Scope filter (`isFiscalFor`): null/undefined = every channel. */
  isFiscal?: boolean | null;
}): Promise<
  ActionResult<{
    items: (PaymentOrder & { supplier_legal_name: string })[];
    nextOffset: number | null;
  }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "payment_orders:read")) {
    return { ok: false, error: "No tenés permiso para ver órdenes de pago." };
  }

  const limit = input?.limit ?? 100;
  const supabase = await createSupabaseClient();
  const { data, error } = await applyFiscalFilter(
    supabase
      .from("payment_orders")
      .select(
        `${COLUMNS}, suppliers ( legal_name ), channel:invoicing_channels ( is_fiscal )`,
      ),
    input?.isFiscal,
    "channel",
  )
    .order("payment_date", { ascending: false })
    .order("numero", { ascending: false })
    .range(0, limit - 1);

  if (error) {
    logger.error("payment_orders.list.failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron listar las órdenes de pago." };
  }

  const items = (data ?? [])
    .map((row) => {
      const narrowed = narrowPaymentOrder(row);
      if (!narrowed) return null;
      const sup = (row as unknown as SupplierListLegalJoin).suppliers;
      return { ...narrowed, supplier_legal_name: sup?.legal_name ?? "—" };
    })
    .filter(
      (r): r is PaymentOrder & { supplier_legal_name: string } => r !== null,
    );

  return {
    ok: true,
    data: { items, nextOffset: items.length === limit ? limit : null },
  };
}

export type PaymentOrderDetail = {
  paymentOrder: PaymentOrder & {
    supplier_legal_name: string;
    supplier_cuit: string;
  };
  payment_lines: PaymentOrderPaymentLine[];
  allocations: PaymentOrderAllocation[];
};

export async function getPaymentOrderByIdAction(
  id: string,
): Promise<ActionResult<PaymentOrderDetail | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "payment_orders:read")) {
    return { ok: false, error: "No tenés permiso para ver órdenes de pago." };
  }

  const supabase = await createSupabaseClient();
  const { data: row, error: opErr } = await supabase
    .from("payment_orders")
    .select(`${COLUMNS}, suppliers ( legal_name, cuit )`)
    .eq("id", id)
    .maybeSingle();

  if (opErr) {
    logger.error("payment_orders.get.failed", {
      userId: ctx.userId,
      id,
      error: opErr,
    });
    return { ok: false, error: "No se pudo cargar la orden de pago." };
  }
  if (!row) return { ok: true, data: null };
  const paymentOrder = narrowPaymentOrder(row);
  if (!paymentOrder) {
    return { ok: false, error: "Orden de pago con datos inválidos." };
  }
  const sup = (row as unknown as SupplierIdentityJoin).suppliers;

  const [linesRes, allocsRes] = await Promise.all([
    supabase
      .from("payment_order_payment_lines")
      .select(
        "*, account:accounts(name, type), endorsed_check:checks!payment_order_payment_lines_endorsed_check_id_fkey(id, kind, check_number, bank_name, due_date, drawer_name), issued_check:issued_checks!payment_order_payment_lines_issued_check_id_fkey(id, kind, check_number, bank_name, due_date, status)",
      )
      .eq("payment_order_id", id)
      .order("created_at"),
    supabase
      .from("payment_order_allocations")
      .select(
        "*, purchase_invoice:purchase_invoices(letter, kind, punto_venta, numero, fecha, imp_total)",
      )
      .eq("payment_order_id", id)
      .order("created_at"),
  ]);

  if (linesRes.error || allocsRes.error) {
    logger.error("payment_orders.get.children_failed", {
      userId: ctx.userId,
      id,
      lines: linesRes.error,
      allocs: allocsRes.error,
    });
    return { ok: false, error: "No se pudieron cargar los detalles." };
  }

  return {
    ok: true,
    data: {
      paymentOrder: {
        ...paymentOrder,
        supplier_legal_name: sup?.legal_name ?? "—",
        supplier_cuit: sup?.cuit ?? "",
      },
      payment_lines: linesRes.data ?? [],
      allocations: allocsRes.data ?? [],
    },
  };
}

export async function getNextPaymentOrderNumeroAction(input: {
  channel_id: string;
}): Promise<ActionResult<{ next: number; isFirst: boolean }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "payment_orders:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const pos = await loadChannelPos(input.channel_id);
  if (!pos) {
    return {
      ok: false,
      error: "Configurá un POS habilitado para este canal.",
    };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("payment_orders")
    .select("numero")
    .eq("channel_id", input.channel_id)
    .eq("punto_venta", pos.punto_venta)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error("payment_orders.next_numero.failed", {
      userId: ctx.userId,
      channel_id: input.channel_id,
      error,
    });
    return { ok: false, error: "No se pudo calcular el próximo número." };
  }

  const lastNumero = data?.numero ?? 0;
  return {
    ok: true,
    data: { next: lastNumero + 1, isFirst: lastNumero === 0 },
  };
}

export type PendingPurchaseInvoice = {
  id: string;
  numero: number;
  punto_venta: number;
  letter: string | null;
  kind: string;
  fecha: string;
  imp_total: number;
  already_allocated: number;
  outstanding: number;
  /** The purchase's moneda as an OP currency (DOL → USD, else ARS). */
  currency: "ARS" | "USD";
};

/** Pending purchase invoices of a supplier on one channel: a payment order
 *  only settles invoices of its own channel (guard_payment_order_allocation
 *  enforces it). */
export async function listPendingInvoicesForSupplierAction(
  supplierId: string,
  channelId: string,
  excludePaymentOrderId?: string,
): Promise<ActionResult<PendingPurchaseInvoice[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "payment_orders:read")) {
    return { ok: false, error: "No tenés permiso." };
  }

  const supabase = await createSupabaseClient();

  type Row = {
    id: string;
    numero: number;
    punto_venta: number;
    letter: string | null;
    kind: string;
    fecha: string;
    imp_total: number | string;
    moneda: string | null;
  };
  // What is still open comes from v_purchase_invoice_open (OPs, NCs and the
  // opening balance), the same figure guard_payment_order_allocation and the
  // aging use. When editing an OP, its own allocations are added back.
  // Total order (fecha alone ties → id) so OFFSET pages never repeat/skip.
  const [invoicesRes, openRes, editedRes] = await Promise.all([
    paginateRange((from, to) =>
      supabase
        .from("purchase_invoices")
        .select(
          "id, numero, punto_venta, letter, kind, fecha, imp_total, moneda",
        )
        .eq("supplier_id", supplierId)
        .eq("channel_id", channelId)
        .eq("status", "received")
        .order("fecha", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("v_purchase_invoice_open")
        .select("purchase_invoice_id, open_amount")
        .eq("supplier_id", supplierId)
        .eq("channel_id", channelId)
        .order("purchase_invoice_id", { ascending: true })
        .range(from, to),
    ),
    excludePaymentOrderId
      ? paginateRange((from, to) =>
          supabase
            .from("payment_order_allocations")
            .select(
              "id, purchase_invoice_id, amount_applied, payment_orders!inner ( status )",
            )
            .eq("payment_order_id", excludePaymentOrderId)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (invoicesRes.error) {
    logger.error("payment_orders.pending.list_invoices_failed", {
      userId: ctx.userId,
      supplierId,
      error: invoicesRes.error,
    });
    return { ok: false, error: "No se pudieron listar facturas pendientes." };
  }
  if (openRes.error || editedRes.error) {
    logger.error("payment_orders.pending.list_allocations_failed", {
      userId: ctx.userId,
      supplierId,
      error: openRes.error ?? editedRes.error,
    });
    return { ok: false, error: "No se pudieron leer las imputaciones." };
  }
  const invoices: Row[] = invoicesRes.data;
  if (invoices.length === 0) return { ok: true, data: [] };

  const openByInvoice = new Map<string, number>();
  for (const o of openRes.data) {
    if (o.purchase_invoice_id === null) continue;
    openByInvoice.set(o.purchase_invoice_id, Number(o.open_amount ?? 0));
  }
  const editedByInvoice = new Map<string, number>();
  for (const a of editedRes.data) {
    if (readEmbeddedStatus(a.payment_orders) !== "issued") continue;
    editedByInvoice.set(
      a.purchase_invoice_id,
      (editedByInvoice.get(a.purchase_invoice_id) ?? 0) +
        Number(a.amount_applied),
    );
  }

  // NCs are not paid by an OP: they reduce their origin's open amount.
  const pending: PendingPurchaseInvoice[] = invoices
    .filter((c) => c.kind === "factura" || c.kind === "nd")
    .map((c) => {
      const total = Number(c.imp_total ?? 0);
      const open =
        (openByInvoice.get(c.id) ?? 0) + (editedByInvoice.get(c.id) ?? 0);
      const outstanding = round2(Math.max(0, open));
      return {
        id: c.id,
        numero: c.numero,
        punto_venta: c.punto_venta,
        letter: c.letter,
        kind: c.kind,
        fecha: c.fecha,
        imp_total: total,
        already_allocated: round2(total - outstanding),
        outstanding,
        currency: paymentCurrencyOf(c.moneda),
      };
    })
    .filter((c) => c.outstanding > 0.005);

  return { ok: true, data: pending };
}

async function loadChannelPos(
  channelId: string,
): Promise<{ punto_venta: number } | null> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("sales_points")
    .select("numero, channel_id, is_enabled")
    .eq("channel_id", channelId)
    .eq("is_enabled", true)
    .order("numero", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { punto_venta: data.numero };
}

export async function createPaymentOrderAction(
  input: unknown,
): Promise<ActionResult<{ id: string; numero: number; punto_venta: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "payment_orders:write")) {
    return {
      ok: false,
      error: "No tenés permiso para emitir órdenes de pago.",
    };
  }

  const parsed = PaymentOrderCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const pos = await loadChannelPos(data.channel_id);
  if (!pos) {
    return {
      ok: false,
      error: `El canal ${data.channel_id} no tiene un punto de venta habilitado.`,
    };
  }

  // FIFO auto-allocation when the user did not choose manual allocations,
  // over the pending purchases in the OP's currency.
  let allocations = data.allocations ?? [];
  if (allocations.length === 0) {
    const pendingRes = await listPendingInvoicesForSupplierAction(
      data.supplier_id,
      data.channel_id,
    );
    if (!pendingRes.ok) return pendingRes;
    allocations = allocateFifo(
      pendingRes.data.filter((c) => c.currency === data.currency),
      data.total_amount,
    ).map((a) => ({
      purchase_invoice_id: a.document_id,
      amount_applied: a.amount_applied,
    }));
  }

  const supabase = await createSupabaseClient();
  const { data: opId, error } = await supabase.rpc("create_payment_order", {
    p_channel_id: data.channel_id,
    p_punto_venta: pos.punto_venta,
    p_numero: data.numero,
    p_supplier_id: data.supplier_id,
    p_payment_date: data.payment_date,
    p_total_amount: data.total_amount,
    p_currency: data.currency,
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
      userId: ctx.userId,
    });
    if (guardError) return { ok: false, error: guardError };
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: `El número ${data.numero} ya existe para ese canal/POS.`,
      };
    }
    logger.error("payment_orders.create.failed", {
      userId: ctx.userId,
      channel_id: data.channel_id,
      numero: data.numero,
      supplier_id: data.supplier_id,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo crear la orden de pago.",
    };
  }

  await logAudit(
    "payment_order.created",
    ctx.userId,
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

export async function updatePaymentOrderAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "payment_orders:write")) {
    return {
      ok: false,
      error: "No tenés permiso para editar órdenes de pago.",
    };
  }

  const parsed = PaymentOrderUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("update_payment_order", {
    p_id: data.id,
    p_payment_date: data.payment_date,
    p_total_amount: data.total_amount,
    p_notes: data.notes ?? "",
    p_payment_lines: data.payment_lines.map(serializePaymentLine),
    p_allocations: (data.allocations ?? []).map((a) => ({
      purchase_invoice_id: a.purchase_invoice_id,
      amount_applied: a.amount_applied,
    })),
  });

  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "payment_orders.update.rejected",
      userId: ctx.userId,
      id: data.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("payment_orders.update.failed", {
      userId: ctx.userId,
      id: data.id,
      error,
    });
    return {
      ok: false,
      error: error.message ?? "No se pudo actualizar la OP.",
    };
  }

  await logAudit(
    "payment_order.updated",
    ctx.userId,
    { total_amount: data.total_amount },
    data.id,
  );
  return { ok: true, data: undefined };
}

export async function cancelPaymentOrderAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "payment_orders:write")) {
    return {
      ok: false,
      error: "No tenés permiso para anular órdenes de pago.",
    };
  }

  const parsed = PaymentOrderCancelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { data: cancelled, error } = await supabase
    .from("payment_orders")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      canceled_by: ctx.userId,
    })
    .eq("id", parsed.data.id)
    .eq("status", "issued")
    .select("id");

  if (error) {
    const guardError = mapDbGuardError(error, {
      slug: "payment_orders.cancel.rejected",
      userId: ctx.userId,
      id: parsed.data.id,
    });
    if (guardError) return { ok: false, error: guardError };
    logger.error("payment_orders.cancel.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo anular la orden de pago." };
  }
  if (!cancelled || cancelled.length === 0) {
    return {
      ok: false,
      error:
        "La orden de pago ya estaba anulada o no se encontró. Recargá la página.",
    };
  }

  await logAudit("payment_order.canceled", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
