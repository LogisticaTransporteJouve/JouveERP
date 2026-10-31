/**
 * Totals of a document list as the `*_list_totals` RPCs return them: one row
 * per (bucket, currency). `bucket` is null for the grand total (no grouping).
 */
export interface ListTotalRow {
  bucket: string | null;
  currency: string;
  documents: number;
  total: number;
}

export interface TotalsSummary {
  documents: number;
  /** One amount per currency, ARS first; currencies never sum. */
  amounts: { currency: string; total: number }[];
}

export function grandTotal(rows: ListTotalRow[]): TotalsSummary {
  const byCurrency = new Map<string, number>();
  let documents = 0;
  for (const row of rows) {
    documents += row.documents;
    byCurrency.set(
      row.currency,
      (byCurrency.get(row.currency) ?? 0) + row.total,
    );
  }
  const amounts = [...byCurrency.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) =>
      a.currency === "ARS"
        ? -1
        : b.currency === "ARS"
          ? 1
          : a.currency.localeCompare(b.currency),
    );
  return { documents, amounts };
}

export function totalsByBucket(
  rows: ListTotalRow[],
): Map<string, TotalsSummary> {
  const groups = new Map<string, ListTotalRow[]>();
  for (const row of rows) {
    if (row.bucket === null) continue;
    groups.set(row.bucket, [...(groups.get(row.bucket) ?? []), row]);
  }
  return new Map(
    [...groups.entries()].map(([bucket, group]) => [bucket, grandTotal(group)]),
  );
}

/** AFIP currency codes on comprobantes → the app's ISO codes. */
export function isoCurrency(moneda: string): string {
  if (moneda === "PES") return "ARS";
  if (moneda === "DOL") return "USD";
  return moneda;
}
