"use server";


import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

import {
  isReceiptCurrency,
  isReceiptStatus,
  isRetentionKind,
  isRetentionTaxType,
  ReceiptCancelSchema,
  ReceiptCreateSchema,
  ReceiptUpdateSchema,
  type Receipt,
  type ReceiptAllocation,
  type ReceiptPaymentLine,
  type ReceiptRetention,
} from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue | undefined }
  | JsonValue[];

const UNIQUE_VIOLATION = "23505";

async function logAudit(
  eventType: string,
  actorId: string,
  payload: { [k: string]: JsonValue | undefined },
  targetResourceId?: string,
) {
  const service = getServiceClient();
  const { error } = await service.from("audit_events").insert({
    actor_id: actorId,
    event_type: eventType,
    target_resource_id: targetResourceId ?? null,
    payload,
  });
  if (error) {
    logger.error("audit.insert.failed", { eventType, error });
  }
}

function narrowReceipt(row: {
  status: string;
  currency: string;
  [key: string]: unknown;
}): Receipt | null {
  if (!isReceiptStatus(row.status)) {
    logger.error("receipts.unknown_status", { value: row.status });
    return null;
  }
  if (!isReceiptCurrency(row.currency)) {
    logger.error("receipts.unknown_currency", { value: row.currency });
    return null;
  }
  return row as unknown as Receipt;
}

const RECEIPT_COLUMNS =
  "id, channel_id, punto_venta, numero, client_id, recibo_date, total_amount, currency, notes, status, canceled_at, canceled_by, created_by, created_at, updated_at";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listReceiptsAction(): Promise<
  ActionResult<{
    receipts: (Receipt & { client_legal_name: string })[];
  }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:read")) {
    return { ok: false, error: "No tenés permiso para ver recibos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("receipts")
    .select(`${RECEIPT_COLUMNS}, clients ( legal_name )`)
    .order("recibo_date", { ascending: false })
    .order("numero", { ascending: false });

  if (error) {
    logger.error("receipts.list.failed", { error });
    return { ok: false, error: "No se pudieron listar los recibos." };
  }

  const receipts = (data ?? [])
    .map((row) => {
      const narrowed = narrowReceipt(row);
      if (!narrowed) return null;
      const clientRel = (row as { clients: { legal_name: string } | null })
        .clients;
      return {
        ...narrowed,
        client_legal_name: clientRel?.legal_name ?? "—",
      };
    })
    .filter(
      (
        r,
      ): r is Receipt & { client_legal_name: string } => r !== null,
    );

  return { ok: true, data: { receipts } };
}

export type ReceiptDetail = {
  receipt: Receipt;
  payment_lines: ReceiptPaymentLine[];
  allocations: ReceiptAllocation[];
  retentions: ReceiptRetention[];
};

function narrowRetention(row: {
  kind: string;
  tax_type: string;
  [key: string]: unknown;
}): ReceiptRetention | null {
  if (!isRetentionKind(row.kind)) {
    logger.error("receipts.unknown_retention_kind", { value: row.kind });
    return null;
  }
  if (!isRetentionTaxType(row.tax_type)) {
    logger.error("receipts.unknown_retention_tax_type", {
      value: row.tax_type,
    });
    return null;
  }
  return row as unknown as ReceiptRetention;
}

export async function getReceiptByIdAction(
  id: string,
): Promise<ActionResult<ReceiptDetail | null>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:read")) {
    return { ok: false, error: "No tenés permiso para ver recibos." };
  }

  const supabase = await createSupabaseClient();
  const { data: receiptRow, error: receiptError } = await supabase
    .from("receipts")
    .select(RECEIPT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (receiptError) {
    logger.error("receipts.get.failed", { id, error: receiptError });
    return { ok: false, error: "No se pudo cargar el recibo." };
  }
  if (!receiptRow) return { ok: true, data: null };
  const receipt = narrowReceipt(receiptRow);
  if (!receipt) {
    return { ok: false, error: "Recibo con datos inválidos." };
  }

  const [linesRes, allocsRes, retentionsRes] = await Promise.all([
    supabase
      .from("receipt_payment_lines")
      .select("*")
      .eq("receipt_id", id)
      .order("created_at"),
    supabase
      .from("receipt_allocations")
      .select("*")
      .eq("receipt_id", id)
      .order("created_at"),
    supabase
      .from("receipt_retentions")
      .select("*")
      .eq("receipt_id", id)
      .order("created_at"),
  ]);

  if (linesRes.error || allocsRes.error || retentionsRes.error) {
    logger.error("receipts.get.children_failed", {
      id,
      lines: linesRes.error,
      allocs: allocsRes.error,
      retentions: retentionsRes.error,
    });
    return { ok: false, error: "No se pudieron cargar los detalles." };
  }

  const retentions = (retentionsRes.data ?? [])
    .map((row) => narrowRetention(row))
    .filter((r): r is ReceiptRetention => r !== null);

  return {
    ok: true,
    data: {
      receipt,
      payment_lines: linesRes.data ?? [],
      allocations: allocsRes.data ?? [],
      retentions,
    },
  };
}

/**
 * Returns the next number to suggest for a (channel_id, punto_venta) pair.
 * If no receipt exists for the channel yet, returns 1 — but the form lets
 * the user override the first number.
 */
export async function getNextReceiptNumeroAction(input: {
  channel_id: string;
  punto_venta: number;
}): Promise<ActionResult<{ next: number; isFirst: boolean }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:read")) {
    return { ok: false, error: "No tenés permiso para ver recibos." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("numero")
    .eq("channel_id", input.channel_id)
    .eq("punto_venta", input.punto_venta)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error("receipts.next_numero.failed", { error });
    return { ok: false, error: "No se pudo calcular el próximo número." };
  }

  const lastNumero = data?.numero ?? 0;
  return {
    ok: true,
    data: { next: lastNumero + 1, isFirst: lastNumero === 0 },
  };
}

/**
 * Returns issued comprobantes for a client with how much is still
 * outstanding (after subtracting prior allocations). Used by the dialog
 * "imputar a facturas" picker.
 */
export type PendingComprobante = {
  id: string;
  numero: number | null;
  punto_venta: number;
  letter: string | null;
  kind: string;
  fecha: string;
  imp_total: number;
  already_allocated: number;
  outstanding: number;
};

export async function listPendingComprobantesForClientAction(
  clientId: string,
  excludeReceiptId?: string,
): Promise<ActionResult<PendingComprobante[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:read")) {
    return { ok: false, error: "No tenés permiso para ver recibos." };
  }

  const supabase = await createSupabaseClient();
  const { data: comprobantes, error: cErr } = await supabase
    .from("comprobantes")
    .select("id, numero, punto_venta, letter, kind, fecha, imp_total, status")
    .eq("client_id", clientId)
    .eq("status", "emitted")
    .order("fecha", { ascending: false });

  if (cErr) {
    logger.error("receipts.pending.list_comprobantes_failed", { error: cErr });
    return {
      ok: false,
      error: "No se pudieron listar los comprobantes pendientes.",
    };
  }

  const ids = (comprobantes ?? []).map((c) => c.id);
  if (ids.length === 0) return { ok: true, data: [] };

  const allocsQuery = supabase
    .from("receipt_allocations")
    .select("comprobante_id, amount_applied, receipt_id, receipts ( status )")
    .in("comprobante_id", ids);

  const { data: allocations, error: aErr } = await allocsQuery;
  if (aErr) {
    logger.error("receipts.pending.list_allocations_failed", { error: aErr });
    return { ok: false, error: "No se pudieron leer las imputaciones." };
  }

  const allocatedByComprobante = new Map<string, number>();
  for (const alloc of allocations ?? []) {
    const status = (
      alloc as unknown as { receipts: { status: string } | null }
    ).receipts?.status;
    if (status === "canceled") continue;
    if (
      excludeReceiptId &&
      (alloc as unknown as { receipt_id: string }).receipt_id ===
        excludeReceiptId
    )
      continue;
    const prev = allocatedByComprobante.get(alloc.comprobante_id) ?? 0;
    allocatedByComprobante.set(
      alloc.comprobante_id,
      prev + Number(alloc.amount_applied),
    );
  }

  const pending: PendingComprobante[] = (comprobantes ?? [])
    .map((c) => {
      const already = allocatedByComprobante.get(c.id) ?? 0;
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
    .filter((c) => c.outstanding > 0.005);

  return { ok: true, data: pending };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function loadChannelPos(
  channelId: string,
): Promise<{ punto_venta: number } | null> {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("puntos_de_venta")
    .select("numero, channel_id, is_enabled")
    .eq("channel_id", channelId)
    .eq("is_enabled", true)
    .order("numero", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { punto_venta: data.numero };
}

export async function createReceiptAction(
  input: unknown,
): Promise<ActionResult<{ id: string; numero: number; punto_venta: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:write")) {
    return { ok: false, error: "No tenés permiso para emitir recibos." };
  }

  const parsed = ReceiptCreateSchema.safeParse(input);
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

  const supabase = await createSupabaseClient();
  const { data: receiptId, error } = await supabase.rpc("create_receipt", {
    p_channel_id: data.channel_id,
    p_punto_venta: pos.punto_venta,
    p_numero: data.numero,
    p_client_id: data.client_id,
    p_recibo_date: data.recibo_date,
    p_total_amount: data.total_amount,
    p_currency: data.currency,
    p_notes: data.notes ?? "",
    p_payment_lines: data.payment_lines.map((l) => ({
      account_id: l.account_id,
      amount: l.amount,
      reference: l.reference ?? null,
    })),
    p_allocations: (data.allocations ?? []).map((a) => ({
      comprobante_id: a.comprobante_id,
      amount_applied: a.amount_applied,
    })),
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
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: `El número ${data.numero} ya existe para ese canal/POS.`,
      };
    }
    logger.error("receipts.create.failed", { error });
    return {
      ok: false,
      error: error.message ?? "No se pudo crear el recibo.",
    };
  }

  await logAudit(
    "receipt.created",
    ctx.userId,
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

export async function updateReceiptAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:write")) {
    return { ok: false, error: "No tenés permiso para editar recibos." };
  }

  const parsed = ReceiptUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const data = parsed.data;

  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("update_receipt", {
    p_id: data.id,
    p_recibo_date: data.recibo_date,
    p_total_amount: data.total_amount,
    p_notes: data.notes ?? "",
    p_payment_lines: data.payment_lines.map((l) => ({
      account_id: l.account_id,
      amount: l.amount,
      reference: l.reference ?? null,
    })),
    p_allocations: (data.allocations ?? []).map((a) => ({
      comprobante_id: a.comprobante_id,
      amount_applied: a.amount_applied,
    })),
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
    logger.error("receipts.update.failed", { error });
    return {
      ok: false,
      error: error.message ?? "No se pudo actualizar el recibo.",
    };
  }

  await logAudit(
    "receipt.updated",
    ctx.userId,
    { total_amount: data.total_amount },
    data.id,
  );
  return { ok: true, data: undefined };
}

export async function cancelReceiptAction(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:write")) {
    return { ok: false, error: "No tenés permiso para anular recibos." };
  }

  const parsed = ReceiptCancelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("receipts")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      canceled_by: ctx.userId,
    })
    .eq("id", parsed.data.id)
    .eq("status", "issued");

  if (error) {
    logger.error("receipts.cancel.failed", { error });
    return { ok: false, error: "No se pudo anular el recibo." };
  }

  await logAudit("receipt.canceled", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
