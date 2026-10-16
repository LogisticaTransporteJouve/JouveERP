import { formatMoney, round2 } from "@/lib/format";
import { arsEquivalent, type UsdRate } from "@/lib/fx";

// Aging (clients and suppliers) split by currency. The views return pesos and
// dollars in separate columns (dollars = moneda DOL/USD; any other currency is
// counted as pesos, as the app only issues PES and DOL). This builds the
// per-party rows and the totals, and adds a single ARS-equivalent figure at
// the latest official rate.

export type AgingBucket = "0_30" | "30_60" | "60_90" | "90_plus";
export const AGING_BUCKETS: readonly AgingBucket[] = [
  "0_30",
  "30_60",
  "60_90",
  "90_plus",
];

export type CurrencyAmounts = { ars: number; usd: number };

export type AgingAmounts = {
  buckets: Record<AgingBucket, CurrencyAmounts>;
  total: CurrencyAmounts;
  /** ARS + USD × latest official rate; null when there are dollars and no rate. */
  total_ars_equivalent: number | null;
};

export type AgingPartyRow = AgingAmounts & {
  id: string;
  legal_name: string;
  display_name: string | null;
  cuit: string;
  document_count: number;
  oldest_days: number;
};

export type AgingReport = {
  rows: AgingPartyRow[];
  totals: AgingAmounts & { party_count: number; document_count: number };
  usd_rate: UsdRate | null;
};

/** Amount columns shared by `v_client_aging` and `v_supplier_aging`. */
export type AgingViewAmounts = {
  ars_bucket_0_30: number | null;
  ars_bucket_30_60: number | null;
  ars_bucket_60_90: number | null;
  ars_bucket_90_plus: number | null;
  ars_total_open: number | null;
  usd_bucket_0_30: number | null;
  usd_bucket_30_60: number | null;
  usd_bucket_60_90: number | null;
  usd_bucket_90_plus: number | null;
  usd_total_open: number | null;
  document_count: number | null;
  oldest_days: number | null;
};

export type AgingPartyInput = AgingViewAmounts & {
  id: string;
  legal_name: string;
  display_name: string | null;
  cuit: string;
};

/** The columns to select from either aging view, after the party id. */
export const AGING_VIEW_AMOUNT_COLUMNS =
  "ars_bucket_0_30, ars_bucket_30_60, ars_bucket_60_90, ars_bucket_90_plus, ars_total_open, usd_bucket_0_30, usd_bucket_30_60, usd_bucket_60_90, usd_bucket_90_plus, usd_total_open, document_count, oldest_days";

function emptyBuckets(): Record<AgingBucket, CurrencyAmounts> {
  return {
    "0_30": { ars: 0, usd: 0 },
    "30_60": { ars: 0, usd: 0 },
    "60_90": { ars: 0, usd: 0 },
    "90_plus": { ars: 0, usd: 0 },
  };
}

function viewBuckets(
  v: AgingViewAmounts,
): Record<AgingBucket, CurrencyAmounts> {
  return {
    "0_30": {
      ars: Number(v.ars_bucket_0_30 ?? 0),
      usd: Number(v.usd_bucket_0_30 ?? 0),
    },
    "30_60": {
      ars: Number(v.ars_bucket_30_60 ?? 0),
      usd: Number(v.usd_bucket_30_60 ?? 0),
    },
    "60_90": {
      ars: Number(v.ars_bucket_60_90 ?? 0),
      usd: Number(v.usd_bucket_60_90 ?? 0),
    },
    "90_plus": {
      ars: Number(v.ars_bucket_90_plus ?? 0),
      usd: Number(v.usd_bucket_90_plus ?? 0),
    },
  };
}

/** Sort key: the ARS equivalent, else pesos then dollars (no rate loaded). */
function compareByExposure(a: AgingPartyRow, b: AgingPartyRow): number {
  const ea = a.total_ars_equivalent;
  const eb = b.total_ars_equivalent;
  if (ea !== null && eb !== null && ea !== eb) return eb - ea;
  if (a.total.ars !== b.total.ars) return b.total.ars - a.total.ars;
  if (a.total.usd !== b.total.usd) return b.total.usd - a.total.usd;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Rows sorted by exposure (largest first) plus per-currency totals. Sums are
 *  rounded to cents: the views return exact numerics but JS floats drift. */
export function buildAgingReport(
  input: readonly AgingPartyInput[],
  usdRate: UsdRate | null,
): AgingReport {
  const rate = usdRate?.rate ?? null;
  const totalsBuckets = emptyBuckets();
  const total: CurrencyAmounts = { ars: 0, usd: 0 };
  let documentCount = 0;

  const rows: AgingPartyRow[] = input.map((r) => {
    const buckets = viewBuckets(r);
    const rowTotal = {
      ars: Number(r.ars_total_open ?? 0),
      usd: Number(r.usd_total_open ?? 0),
    };
    for (const b of AGING_BUCKETS) {
      totalsBuckets[b].ars += buckets[b].ars;
      totalsBuckets[b].usd += buckets[b].usd;
    }
    total.ars += rowTotal.ars;
    total.usd += rowTotal.usd;
    const documents = Number(r.document_count ?? 0);
    documentCount += documents;
    return {
      id: r.id,
      legal_name: r.legal_name,
      display_name: r.display_name,
      cuit: r.cuit,
      buckets,
      total: rowTotal,
      total_ars_equivalent: arsEquivalent(rowTotal.ars, rowTotal.usd, rate),
      document_count: documents,
      oldest_days: Number(r.oldest_days ?? 0),
    };
  });
  rows.sort(compareByExposure);

  for (const b of AGING_BUCKETS) {
    totalsBuckets[b] = {
      ars: round2(totalsBuckets[b].ars),
      usd: round2(totalsBuckets[b].usd),
    };
  }
  const roundedTotal = { ars: round2(total.ars), usd: round2(total.usd) };

  return {
    rows,
    totals: {
      buckets: totalsBuckets,
      total: roundedTotal,
      total_ars_equivalent: arsEquivalent(
        roundedTotal.ars,
        roundedTotal.usd,
        rate,
      ),
      party_count: rows.length,
      document_count: documentCount,
    },
    usd_rate: usdRate,
  };
}

/** Row of `v_client_aging` with the embedded `clients` join. */
export type ClientAgingViewRow = AgingViewAmounts & {
  client_id: string | null;
  clients: {
    legal_name: string;
    display_name: string | null;
    cuit: string;
  } | null;
};

/** Row of `v_supplier_aging` with the embedded `suppliers` join. */
export type SupplierAgingViewRow = AgingViewAmounts & {
  supplier_id: string | null;
  suppliers: { legal_name: string; cuit: string } | null;
};

/** Client aging report; rows without `client_id`/`clients` are discarded. */
export function aggregateClientAging(
  rows: readonly ClientAgingViewRow[],
  usdRate: UsdRate | null,
): AgingReport {
  const input: AgingPartyInput[] = [];
  for (const row of rows) {
    if (!row.client_id || !row.clients) continue;
    input.push({
      ...row,
      id: row.client_id,
      legal_name: row.clients.legal_name,
      display_name: row.clients.display_name,
      cuit: row.clients.cuit,
    });
  }
  return buildAgingReport(input, usdRate);
}

/** Supplier aging report; rows without `supplier_id`/`suppliers` are discarded. */
export function aggregateSupplierAging(
  rows: readonly SupplierAgingViewRow[],
  usdRate: UsdRate | null,
): AgingReport {
  const input: AgingPartyInput[] = [];
  for (const row of rows) {
    if (!row.supplier_id || !row.suppliers) continue;
    input.push({
      ...row,
      id: row.supplier_id,
      legal_name: row.suppliers.legal_name,
      display_name: null,
      cuit: row.suppliers.cuit,
    });
  }
  return buildAgingReport(input, usdRate);
}

/** True when the party has anything in the 60+ day buckets. */
export function isAgingOverdue(amounts: AgingAmounts): boolean {
  const late = [amounts.buckets["60_90"], amounts.buckets["90_plus"]];
  return late.some((b) => b.ars > 0 || b.usd > 0);
}

/** "$ 1.234,56 · US$ 500,00" — pesos always, dollars only when non-zero. */
export function formatCurrencyAmounts(amounts: CurrencyAmounts): string {
  const ars = formatMoney(amounts.ars);
  return amounts.usd !== 0
    ? `${ars} · ${formatMoney(amounts.usd, "USD")}`
    : ars;
}
