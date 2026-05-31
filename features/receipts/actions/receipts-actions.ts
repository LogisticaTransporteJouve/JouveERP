"use server";

import { logAudit } from "@/lib/actions/audit";
import type { ActionResult } from "@/lib/query/run-action";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

import type { ClientsListLegalJoin } from "@/features/clients/schema";

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
  type ReceiptAllocationStatusRow,
} from "../schema";

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
  return row as Receipt;
}

const RECEIPT_COLUMNS =
  "id, channel_id, punto_venta, numero, client_id, receipt_date, total_amount, currency, notes, status, canceled_at, canceled_by, created_by, created_at, updated_at";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listReceiptsAction(input?: {
  offset?: number;
  limit?: number;
  query?: string | null;
  status?: "issued" | "canceled" | null;
  channelId?: string | null;
}): Promise<
  ActionResult<{
    items: (Receipt & { client_legal_name: string })[];
    nextOffset: number | null;
  }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:read")) {
    return { ok: false, error: "No tenés permiso para ver recibos." };
  }

  const offset = input?.offset ?? 0;
  const limit = input?.limit ?? 50;
  const supabase = await createSupabaseClient();
  let query = supabase
    .from("receipts")
    .select(`${RECEIPT_COLUMNS}, clients ( legal_name )`)
    .order("receipt_date", { ascending: false })
    .order("numero", { ascending: false })
    // Tie-breaker: numero es unique per channel. Sin channel filter, dos
    // canales pueden compartir (receipt_date, numero) → paginación no-det.
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (input?.status) query = query.eq("status", input.status);
  if (input?.channelId) query = query.eq("channel_id", input.channelId);
  if (input?.query?.trim()) {
    // Búsqueda por numero exact (no fulltext acá; el ⌘K global cubre eso).
    const n = Number(input.query.trim());
    if (Number.isFinite(n)) {
      query = query.eq("numero", n);
    }
  }

  const { data, error } = await query;
  if (error) {
    logger.error("receipts.list.failed", {
      userId: ctx.userId,
      filters: { status: input?.status, channelId: input?.channelId },
      error,
    });
    return { ok: false, error: "No se pudieron listar los recibos." };
  }

  const items = (data ?? [])
    .map((row) => {
      const narrowed = narrowReceipt(row);
      if (!narrowed) return null;
      const clientRel = (row as ClientsListLegalJoin).clients;
      return {
        ...narrowed,
        client_legal_name: clientRel?.legal_name ?? "—",
      };
    })
    .filter((r): r is Receipt & { client_legal_name: string } => r !== null);

  return {
    ok: true,
    data: { items, nextOffset: items.length === limit ? offset + limit : null },
  };
}

/** Cheque metadata indexed by source_payment_line_id, so the receipt
 *  edit form can prefill the per-line check draft without an extra query. */
export type ReceiptCheckByLine = Record<
  string,
  {
    check_number: string;
    bank_name: string;
    drawer_name: string;
    drawer_cuit: string | null;
    issue_date: string;
    due_date: string;
    status: string;
  }
>;

export type ReceiptDetail = {
  receipt: Receipt;
  payment_lines: ReceiptPaymentLine[];
  allocations: ReceiptAllocation[];
  retentions: ReceiptRetention[];
  checks_by_line: ReceiptCheckByLine;
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
  return row as ReceiptRetention;
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
    logger.error("receipts.get.failed", {
      userId: ctx.userId,
      id,
      error: receiptError,
    });
    return { ok: false, error: "No se pudo cargar el recibo." };
  }
  if (!receiptRow) return { ok: true, data: null };
  const receipt = narrowReceipt(receiptRow);
  if (!receipt) {
    return { ok: false, error: "Recibo con datos inválidos." };
  }

  const [linesRes, allocsRes, retentionsRes, chequesRes] = await Promise.all([
    supabase
      .from("receipt_payment_lines")
      .select("*, account:accounts(name, type)")
      .eq("receipt_id", id)
      .order("created_at"),
    supabase
      .from("receipt_allocations")
      .select("*, invoice:invoices(letter, kind, punto_venta, numero, fecha)")
      .eq("receipt_id", id)
      .order("created_at"),
    supabase
      .from("receipt_retentions")
      .select("*")
      .eq("receipt_id", id)
      .order("created_at"),
    supabase
      .from("checks")
      .select(
        "check_number, bank_name, drawer_name, drawer_cuit, issue_date, due_date, status, source_payment_line_id",
      )
      .eq("source_receipt_id", id),
  ]);

  if (
    linesRes.error ||
    allocsRes.error ||
    retentionsRes.error ||
    chequesRes.error
  ) {
    logger.error("receipts.get.children_failed", {
      userId: ctx.userId,
      id,
      lines: linesRes.error,
      allocs: allocsRes.error,
      retentions: retentionsRes.error,
      cheques: chequesRes.error,
    });
    return { ok: false, error: "No se pudieron cargar los detalles." };
  }

  const retentions = (retentionsRes.data ?? [])
    .map((row) => narrowRetention(row))
    .filter((r): r is ReceiptRetention => r !== null);

  const checks_by_line: ReceiptCheckByLine = {};
  for (const row of chequesRes.data ?? []) {
    if (!row.source_payment_line_id) continue;
    checks_by_line[row.source_payment_line_id] = {
      check_number: row.check_number,
      bank_name: row.bank_name,
      drawer_name: row.drawer_name,
      drawer_cuit: row.drawer_cuit,
      issue_date: row.issue_date,
      due_date: row.due_date,
      status: row.status,
    };
  }

  return {
    ok: true,
    data: {
      receipt,
      payment_lines: linesRes.data ?? [],
      allocations: allocsRes.data ?? [],
      retentions,
      checks_by_line,
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
}): Promise<ActionResult<{ next: number; isFirst: boolean }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "receipts:read")) {
    return { ok: false, error: "No tenés permiso para ver recibos." };
  }

  // Resolve POS server-side from the channel — same lookup used at create
  // time. The previous version asked the caller for `punto_venta`, but the
  // client hook always passed 0, so the filter never matched real rows and
  // `isFirst` stayed true forever.
  const pos = await loadChannelPos(input.channel_id);
  if (!pos) {
    return { ok: false, error: "Configurá un POS habilitado para este canal." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("numero")
    .eq("channel_id", input.channel_id)
    .eq("punto_venta", pos.punto_venta)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error("receipts.next_numero.failed", {
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

  // PostgREST caps individual responses at 1000 rows (db.max_rows).
  // Chunkeamos para clientes con muchas facturas migradas. Cap defensivo
  // de 50000.
  type InvoiceRow = {
    id: string;
    numero: number | null;
    punto_venta: number;
    letter: string | null;
    kind: string;
    fecha: string;
    imp_total: number | string;
  };
  const CHUNK = 1000;
  const HARD_CAP = 50000;
  const comprobantes: InvoiceRow[] = [];
  for (let offset = 0; offset < HARD_CAP; offset += CHUNK) {
    const { data: chunk, error } = await supabase
      .from("invoices")
      .select("id, numero, punto_venta, letter, kind, fecha, imp_total")
      .eq("client_id", clientId)
      .eq("status", "emitted")
      .order("fecha", { ascending: true })
      .range(offset, offset + CHUNK - 1);
    if (error) {
      logger.error("receipts.pending.list_comprobantes_failed", {
        userId: ctx.userId,
        clientId,
        error,
      });
      return {
        ok: false,
        error: "No se pudieron listar los comprobantes pendientes.",
      };
    }
    const got = (chunk ?? []) as InvoiceRow[];
    comprobantes.push(...got);
    if (got.length < CHUNK) break;
  }

  if (comprobantes.length === 0) return { ok: true, data: [] };

  // Receipt allocations: filtramos por receipts.client_id (no por
  // .in(invoice_id, miles…)) para no reventar la URL de PostgREST.
  // Opening allocations: lo que el ajuste de saldo dejó saldado también
  // debe descontarse del outstanding, sino el picker ofrece imputar de
  // nuevo facturas ya cerradas. Ambas son independientes → en paralelo.
  const [allocsRes, openingAllocsRes] = await Promise.all([
    supabase
      .from("receipt_allocations")
      .select(
        "invoice_id, amount_applied, receipt_id, receipts!inner ( status, client_id )",
      )
      .eq("receipts.client_id", clientId),
    supabase
      .from("client_opening_balance_allocations")
      .select("invoice_id, amount_applied")
      .eq("client_id", clientId),
  ]);
  const { data: allocations, error: aErr } = allocsRes;
  if (aErr) {
    logger.error("receipts.pending.list_allocations_failed", {
      userId: ctx.userId,
      clientId,
      error: aErr,
    });
    return { ok: false, error: "No se pudieron leer las imputaciones." };
  }
  const { data: openingAllocs } = openingAllocsRes;

  const allocatedByComprobante = new Map<string, number>();
  for (const alloc of allocations ?? []) {
    const narrowed = alloc as unknown as ReceiptAllocationStatusRow;
    if (narrowed.receipts?.status === "canceled") continue;
    if (excludeReceiptId && narrowed.receipt_id === excludeReceiptId) continue;
    const prev = allocatedByComprobante.get(alloc.invoice_id) ?? 0;
    allocatedByComprobante.set(
      alloc.invoice_id,
      prev + Number(alloc.amount_applied),
    );
  }
  for (const a of openingAllocs ?? []) {
    const prev = allocatedByComprobante.get(a.invoice_id) ?? 0;
    allocatedByComprobante.set(a.invoice_id, prev + Number(a.amount_applied));
  }

  const pending: PendingComprobante[] = comprobantes
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

  // FIFO auto-allocation: when the user submits without manually picking
  // invoices, distribute the receipt total across pending invoices from
  // the oldest forward until the receipt is consumed. Retenciones reduce
  // what gets distributed because they're credit fiscal, not real cash.
  let allocations = data.allocations ?? [];
  if (allocations.length === 0) {
    const pendingRes = await listPendingComprobantesForClientAction(
      data.client_id,
    );
    if (pendingRes.ok) {
      const oldestFirst = [...pendingRes.data].sort((a, b) =>
        a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0,
      );
      const totalRetentions = (data.retentions ?? []).reduce(
        (acc, r) => acc + r.amount,
        0,
      );
      let remaining = data.total_amount - totalRetentions;
      const auto: typeof allocations = [];
      for (const inv of oldestFirst) {
        if (remaining <= 0.005) break;
        const applied = Math.min(inv.outstanding, remaining);
        if (applied <= 0.005) continue;
        auto.push({
          invoice_id: inv.id,
          amount_applied: round2(applied),
        });
        remaining -= applied;
      }
      allocations = auto;
    }
  }

  const supabase = await createSupabaseClient();
  const { data: receiptId, error } = await supabase.rpc("create_receipt", {
    p_channel_id: data.channel_id,
    p_punto_venta: pos.punto_venta,
    p_numero: data.numero,
    p_client_id: data.client_id,
    p_recibo_date: data.receipt_date,
    p_total_amount: data.total_amount,
    p_currency: data.currency,
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
    p_allocations: allocations.map((a) => ({
      invoice_id: a.invoice_id,
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
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: `El número ${data.numero} ya existe para ese canal/POS.`,
      };
    }
    logger.error("receipts.create.failed", {
      userId: ctx.userId,
      channel_id: data.channel_id,
      numero: data.numero,
      client_id: data.client_id,
      error,
    });
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
    p_recibo_date: data.receipt_date,
    p_total_amount: data.total_amount,
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
    p_allocations: (data.allocations ?? []).map((a) => ({
      invoice_id: a.invoice_id,
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
    logger.error("receipts.update.failed", {
      userId: ctx.userId,
      id: data.id,
      error,
    });
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
    logger.error("receipts.cancel.failed", {
      userId: ctx.userId,
      id: parsed.data.id,
      error,
    });
    return { ok: false, error: "No se pudo anular el recibo." };
  }

  await logAudit("receipt.canceled", ctx.userId, {}, parsed.data.id);
  return { ok: true, data: undefined };
}
