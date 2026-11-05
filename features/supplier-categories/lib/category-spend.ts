import type { SupplierPriceEvolutionRow } from "@/features/suppliers/reports-schema";

/** Most month × supplier rows the supplier breakdown asks for (the RPC cap). */
export const SUPPLIER_ROWS_LIMIT = 1000;

type SpendRow = Pick<
  SupplierPriceEvolutionRow,
  "period" | "dim_id" | "dim_label" | "documents" | "net_ars"
>;

export interface CategoryMonthSpend {
  /** "YYYY-MM". */
  period: string;
  documents: number;
  net: number;
}

export interface CategorySupplierSpend {
  supplierId: string;
  legalName: string;
  documents: number;
  net: number;
}

export interface CategorySpend {
  /** Net ARS of the period: NC subtract, cancelled left out (the RPC's rule). */
  net: number;
  /** Received documents, NC and ND included. */
  documents: number;
  months: CategoryMonthSpend[];
  suppliers: CategorySupplierSpend[];
  /** The supplier rows hit the cap: the supplier table is incomplete (the
   *  totals and months come from their own read and stay exact). */
  suppliersPartial: boolean;
}

const cents = (n: number) => Math.round(n * 100);

/**
 * The category page's figures, from `ai_supplier_price_evolution` grouped by
 * category (one row per month: totals and months) and by supplier (month ×
 * supplier: the supplier table). Sums go through cents so float noise does
 * not show.
 */
export function summarizeCategorySpend(
  monthRows: readonly SpendRow[],
  supplierRows: readonly SpendRow[],
  supplierRowsLimit: number = SUPPLIER_ROWS_LIMIT,
): CategorySpend {
  const months = [...monthRows]
    .map((r) => ({ period: r.period, documents: r.documents, net: r.net_ars }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const bySupplier = new Map<
    string,
    { legalName: string; documents: number; cents: number }
  >();
  for (const r of supplierRows) {
    const prev = bySupplier.get(r.dim_id);
    bySupplier.set(r.dim_id, {
      legalName: r.dim_label,
      documents: (prev?.documents ?? 0) + r.documents,
      cents: (prev?.cents ?? 0) + cents(r.net_ars),
    });
  }
  const suppliers = [...bySupplier.entries()]
    .map(([supplierId, s]) => ({
      supplierId,
      legalName: s.legalName,
      documents: s.documents,
      net: s.cents / 100,
    }))
    .sort((a, b) => b.net - a.net || a.legalName.localeCompare(b.legalName));

  return {
    net: months.reduce((acc, m) => acc + cents(m.net), 0) / 100,
    documents: months.reduce((acc, m) => acc + m.documents, 0),
    months,
    suppliers,
    suppliersPartial: supplierRows.length >= supplierRowsLimit,
  };
}
