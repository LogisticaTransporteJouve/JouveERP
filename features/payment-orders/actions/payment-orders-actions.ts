"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";
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
  type PaymentOrderAllocationStatusRow,
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
  const { data, error } = await supabase
    .from("payment_orders")
    .select(`${COLUMNS}, suppliers ( legal_name )`)
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
};

export async function listPendingInvoicesForSupplierAction(
  supplierId: string,
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
  };
  // Total order (fecha alone ties → id) so OFFSET pages never repeat/skip.
  // Both reads are independent → in parallel.
  const [invoicesRes, allocsRes] = await Promise.all([
    paginateRange((from, to) =>
      supabase
        .from("purchase_invoices")
        .select("id, numero, punto_venta, letter, kind, fecha, imp_total")
        .eq("supplier_id", supplierId)
        .eq("status", "received")
        .order("fecha", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    paginateRange((from, to) =>
      supabase
        .from("payment_order_allocations")
        .select(
          "id, purchase_invoice_id, amount_applied, payment_order_id, payment_orders!inner ( status, supplier_id )",
        )
        .eq("payment_orders.supplier_id", supplierId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (invoicesRes.error) {
    logger.error("payment_orders.pending.list_invoices_failed", {
      userId: ctx.userId,
      supplierId,
      error: invoicesRes.error,
    });
    return { ok: false, error: "No se pudieron listar facturas pendientes." };
  }
  if (allocsRes.error) {
    logger.error("payment_orders.pending.list_allocations_failed", {
      userId: ctx.userId,
      supplierId,
      error: allocsRes.error,
    });
    return { ok: false, error: "No se pudieron leer las imputaciones." };
  }
  const invoices: Row[] = invoicesRes.data;
  if (invoices.length === 0) return { ok: true, data: [] };
  const allocations = allocsRes.data;

  const allocatedByInvoice = new Map<string, number>();
  for (const alloc of allocations ?? []) {
    const narrowed = alloc as unknown as PaymentOrderAllocationStatusRow;
    if (narrowed.payment_orders?.status === "canceled") continue;
    if (
      excludePaymentOrderId &&
      narrowed.payment_order_id === excludePaymentOrderId
    )
      continue;
    const prev = allocatedByInvoice.get(alloc.purchase_invoice_id) ?? 0;
    allocatedByInvoice.set(
      alloc.purchase_invoice_id,
      prev + Number(alloc.amount_applied),
    );
  }

  const pending: PendingPurchaseInvoice[] = invoices
    .map((c) => {
      // NCs are deductions: net amount = invoice/ND positive, NC negative. Here
      // we only handle invoices and NDs (positive); NCs are handled
      // separately in a future iteration.
      if (c.kind === "nc") return null;
      const already = allocatedByInvoice.get(c.id) ?? 0;
      const total = Number(c.imp_total ?? 0);
      const outstanding = Math.max(0, total - already);
      return {
        id: c.id,
        numero: c.numero,
        punto_venta: c.punto_venta,
        letter: c.letter,
        kind: c.kind,
        fecha: c.fecha,
        imp_total: total,
        already_allocated: already,
        outstanding,
      };
    })
    .filter(
      (c): c is PendingPurchaseInvoice => c !== null && c.outstanding > 0.005,
    );

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

  // FIFO auto-allocation when the user did not choose manual allocations.
  let allocations = data.allocations ?? [];
  if (allocations.length === 0) {
    const pendingRes = await listPendingInvoicesForSupplierAction(
      data.supplier_id,
    );
    if (pendingRes.ok) {
      const oldestFirst = [...pendingRes.data].sort((a, b) =>
        a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0,
      );
      let remaining = data.total_amount;
      const auto: typeof allocations = [];
      for (const inv of oldestFirst) {
        if (remaining <= 0.005) break;
        const applied = Math.min(inv.outstanding, remaining);
        if (applied <= 0.005) continue;
        auto.push({
          purchase_invoice_id: inv.id,
          amount_applied: round2(applied),
        });
        remaining -= applied;
      }
      allocations = auto;
    }
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
  const { error } = await supabase
    .from("payment_orders")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      canceled_by: ctx.userId,
    })
    .eq("id", parsed.data.id)
    .eq("status", "issued");

  if (error) {
    logger.error("payment_orders.cancel.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo anular la orden de pago." };
  }

  await logAudit("payment_order.canceled", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
