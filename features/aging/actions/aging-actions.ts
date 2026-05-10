"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type AgingBucket = "0_30" | "30_60" | "60_90" | "90_plus";

export interface ClientAgingRow {
  client_id: string;
  legal_name: string;
  display_name: string | null;
  cuit: string;
  bucket_0_30: number;
  bucket_30_60: number;
  bucket_60_90: number;
  bucket_90_plus: number;
  total_open: number;
  document_count: number;
  oldest_days: number;
}

export interface AgingDocumentRow {
  comprobante_id: string;
  fecha: string;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
  imp_total: number;
  amount_applied: number;
  open_amount: number;
  days_overdue: number;
  bucket: AgingBucket;
  channel_id: string;
  channel_name: string;
  channel_is_fiscal: boolean;
}

export interface AgingSummaryResult {
  clients: ClientAgingRow[];
  totals: {
    bucket_0_30: number;
    bucket_30_60: number;
    bucket_60_90: number;
    bucket_90_plus: number;
    total_open: number;
    client_count: number;
    document_count: number;
  };
}

/**
 * Per-client aging summary with bucket totals. Sorted by `total_open` desc
 * so finance sees the biggest debtors first. Aggregates across all
 * channels (fiscal + interno) — the cuenta corriente is del cliente, no
 * del canal.
 */
export async function getAgingSummaryAction(): Promise<
  ActionResult<AgingSummaryResult>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver aging." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("v_client_aging")
    .select(
      "client_id, bucket_0_30, bucket_30_60, bucket_60_90, bucket_90_plus, total_open, document_count, oldest_days, clients!inner(legal_name, display_name, cuit)",
    )
    .order("total_open", { ascending: false });

  if (error) {
    logger.error("aging.summary.failed", { error });
    return { ok: false, error: "No se pudo cargar el aging." };
  }

  const rows = (data ?? []) as Array<{
    client_id: string | null;
    bucket_0_30: number | null;
    bucket_30_60: number | null;
    bucket_60_90: number | null;
    bucket_90_plus: number | null;
    total_open: number | null;
    document_count: number | null;
    oldest_days: number | null;
    clients: {
      legal_name: string;
      display_name: string | null;
      cuit: string;
    } | null;
  }>;

  const clients: ClientAgingRow[] = [];
  const totals = {
    bucket_0_30: 0,
    bucket_30_60: 0,
    bucket_60_90: 0,
    bucket_90_plus: 0,
    total_open: 0,
    client_count: 0,
    document_count: 0,
  };

  for (const row of rows) {
    if (!row.client_id || !row.clients) continue;
    const r: ClientAgingRow = {
      client_id: row.client_id,
      legal_name: row.clients.legal_name,
      display_name: row.clients.display_name,
      cuit: row.clients.cuit,
      bucket_0_30: Number(row.bucket_0_30 ?? 0),
      bucket_30_60: Number(row.bucket_30_60 ?? 0),
      bucket_60_90: Number(row.bucket_60_90 ?? 0),
      bucket_90_plus: Number(row.bucket_90_plus ?? 0),
      total_open: Number(row.total_open ?? 0),
      document_count: Number(row.document_count ?? 0),
      oldest_days: Number(row.oldest_days ?? 0),
    };
    clients.push(r);
    totals.bucket_0_30 += r.bucket_0_30;
    totals.bucket_30_60 += r.bucket_30_60;
    totals.bucket_60_90 += r.bucket_60_90;
    totals.bucket_90_plus += r.bucket_90_plus;
    totals.total_open += r.total_open;
    totals.document_count += r.document_count;
  }
  totals.client_count = clients.length;
  // Round at the boundary; the views already return numeric(18,2) but
  // floating-point sums can drift.
  for (const k of [
    "bucket_0_30",
    "bucket_30_60",
    "bucket_60_90",
    "bucket_90_plus",
    "total_open",
  ] as const) {
    totals[k] = Math.round(totals[k] * 100) / 100;
  }

  return { ok: true, data: { clients, totals } };
}

/**
 * Per-document aging detail for one client. Used by the drill-down link
 * from the summary table → /clientes/[id] (cuenta corriente tab can pick
 * this up later if we want to highlight unpaid rows).
 */
export async function getAgingDocumentsAction(
  clientId: string,
): Promise<ActionResult<AgingDocumentRow[]>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "clients:read")) {
    return { ok: false, error: "No tenés permiso para ver aging." };
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("v_aging_documents")
    .select(
      "comprobante_id, fecha, kind, letter, punto_venta, numero, imp_total, amount_applied, open_amount, days_overdue, bucket, channel_id, channel_name, channel_is_fiscal",
    )
    .eq("client_id", clientId)
    .order("fecha", { ascending: true });

  if (error) {
    logger.error("aging.documents.failed", { clientId, error });
    return { ok: false, error: "No se pudieron cargar los documentos." };
  }

  const rows = (data ?? []).flatMap((row): AgingDocumentRow[] => {
    if (
      !row.comprobante_id ||
      !row.fecha ||
      !row.kind ||
      row.punto_venta == null ||
      row.numero == null ||
      row.imp_total == null ||
      row.open_amount == null ||
      row.days_overdue == null ||
      !row.bucket ||
      !row.channel_id ||
      !row.channel_name ||
      row.channel_is_fiscal == null
    ) {
      return [];
    }
    return [
      {
        comprobante_id: row.comprobante_id,
        fecha: row.fecha,
        kind: row.kind,
        letter: row.letter,
        punto_venta: row.punto_venta,
        numero: row.numero,
        imp_total: Number(row.imp_total),
        amount_applied: Number(row.amount_applied ?? 0),
        open_amount: Number(row.open_amount),
        days_overdue: Number(row.days_overdue),
        bucket: row.bucket as AgingBucket,
        channel_id: row.channel_id,
        channel_name: row.channel_name,
        channel_is_fiscal: row.channel_is_fiscal,
      },
    ];
  });

  return { ok: true, data: rows };
}
