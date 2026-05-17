"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

// Sorted by total_open desc so finance sees biggest debtors first.
// Aggregates across all channels (fiscal + interno).
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
    .order("total_open", { ascending: false })
    .limit(500);

  if (error) {
    logger.error("aging.summary.failed", { userId: ctx.userId, error });
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
  // Round bucket sums; views return numeric(18,2) but JS float sums drift.
  const round = (n: number) => Math.round(n * 100) / 100;
  totals.bucket_0_30 = round(totals.bucket_0_30);
  totals.bucket_30_60 = round(totals.bucket_30_60);
  totals.bucket_60_90 = round(totals.bucket_60_90);
  totals.bucket_90_plus = round(totals.bucket_90_plus);
  totals.total_open = round(totals.total_open);

  return { ok: true, data: { clients, totals } };
}
