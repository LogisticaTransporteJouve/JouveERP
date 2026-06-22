import { round2 } from "@/lib/format";

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

/** Raw row from the `v_client_aging` view with the embedded join to `clients`. */
export interface AgingViewRow {
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
}

/**
 * Aggregates the aging view rows into typed rows + totals. Discards rows
 * without `client_id`/`clients` (defensive). Buckets are rounded to 2
 * decimals: the view returns numeric(18,2) but summing in JS floats drifts.
 */
export function aggregateClientAging(rows: AgingViewRow[]): AgingSummaryResult {
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
  totals.bucket_0_30 = round2(totals.bucket_0_30);
  totals.bucket_30_60 = round2(totals.bucket_30_60);
  totals.bucket_60_90 = round2(totals.bucket_60_90);
  totals.bucket_90_plus = round2(totals.bucket_90_plus);
  totals.total_open = round2(totals.total_open);

  return { clients, totals };
}
