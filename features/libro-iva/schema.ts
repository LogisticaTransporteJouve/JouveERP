import { round2 } from "@/lib/format";

export type LibroIvaComprasRow = {
  purchase_invoice_id: string;
  fecha: string;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
  supplier_legal_name: string;
  supplier_cuit: string | null;
  cae_proveedor: string | null;
  cae_vto_proveedor: string | null;
  iva_rate_id: number | null;
  iva_rate_pct: string | number | null;
  neto: string | number;
  iva: string | number;
  imp_trib: string | number;
  imp_total: string | number;
  channel_id: string;
  channel_name: string;
  has_items: boolean;
  moneda: string;
  cotizacion: string | number;
  neto_orig: string | number;
  iva_orig: string | number;
  imp_trib_orig: string | number;
  imp_total_orig: string | number;
};

export type LibroIvaComprasGroupedRow = {
  purchase_invoice_id: string;
  fecha: string;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
  supplier_legal_name: string;
  supplier_cuit: string | null;
  cae_proveedor: string | null;
  cae_vto_proveedor: string | null;
  imp_trib: number;
  imp_total: number;
  channel_name: string;
  channel_id: string;
  has_items: boolean;
  /** Pesos: the document's amounts × its cotizacion (the book's figures). */
  per_rate: PerRate;
  moneda: string;
  cotizacion: number;
  /** The same figures in the document's own currency (Libro IVA Digital TXT). */
  orig: { per_rate: PerRate; imp_trib: number; imp_total: number };
};

export function groupComprasByInvoice(
  rows: readonly LibroIvaComprasRow[],
): LibroIvaComprasGroupedRow[] {
  const map = new Map<string, LibroIvaComprasGroupedRow>();
  for (const r of rows) {
    let acc = map.get(r.purchase_invoice_id);
    if (!acc) {
      acc = {
        purchase_invoice_id: r.purchase_invoice_id,
        fecha: r.fecha,
        kind: r.kind,
        letter: r.letter,
        punto_venta: r.punto_venta,
        numero: r.numero,
        supplier_legal_name: r.supplier_legal_name,
        supplier_cuit: r.supplier_cuit,
        cae_proveedor: r.cae_proveedor,
        cae_vto_proveedor: r.cae_vto_proveedor,
        imp_trib: Number(r.imp_trib),
        imp_total: Number(r.imp_total),
        channel_name: r.channel_name,
        channel_id: r.channel_id,
        has_items: r.has_items,
        per_rate: {},
        moneda: r.moneda,
        cotizacion: Number(r.cotizacion),
        orig: {
          per_rate: {},
          imp_trib: Number(r.imp_trib_orig),
          imp_total: Number(r.imp_total_orig),
        },
      };
      map.set(r.purchase_invoice_id, acc);
    }
    const key = r.iva_rate_id ?? -1;
    addRate(acc.per_rate, key, r.neto, r.iva);
    addRate(acc.orig.per_rate, key, r.neto_orig, r.iva_orig);
  }
  return Array.from(map.values());
}

export type LibroIvaComprasTotals = {
  count: number;
  per_rate: Record<number, { neto: number; iva: number }>;
  imp_trib: number;
  imp_total: number;
};

export function computeComprasTotals(
  grouped: readonly LibroIvaComprasGroupedRow[],
): LibroIvaComprasTotals {
  const totals: LibroIvaComprasTotals = {
    count: grouped.length,
    per_rate: {},
    imp_trib: 0,
    imp_total: 0,
  };
  for (const row of grouped) {
    // Notas de crédito de compra reduce the IVA crédito: subtract them.
    const sign = row.kind === "nc" ? -1 : 1;
    for (const [k, v] of Object.entries(row.per_rate)) {
      const id = Number(k);
      const existing = totals.per_rate[id] ?? { neto: 0, iva: 0 };
      totals.per_rate[id] = {
        neto: existing.neto + sign * v.neto,
        iva: existing.iva + sign * v.iva,
      };
    }
    totals.imp_trib += sign * row.imp_trib;
    totals.imp_total += sign * row.imp_total;
  }
  return totals;
}

export type LibroIvaVentasRow = {
  invoice_id: string;
  fecha: string;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
  cbte_tipo_afip: number | null;
  client_legal_name: string;
  doc_tipo: number;
  doc_nro: string;
  cae: string | null;
  cae_vencimiento: string | null;
  iva_rate_id: number | null;
  iva_rate_pct: string | number | null;
  neto: string | number;
  iva: string | number;
  imp_trib: string | number;
  imp_op_ex: string | number;
  imp_tot_conc: string | number;
  imp_total: string | number;
  channel_id: string;
  channel_name: string;
  has_items: boolean;
  moneda: string;
  cotizacion: string | number;
  neto_orig: string | number;
  iva_orig: string | number;
  imp_trib_orig: string | number;
  imp_op_ex_orig: string | number;
  imp_tot_conc_orig: string | number;
  imp_total_orig: string | number;
};

/** Neto + IVA per iva_rate_id (key); -1 = "no breakdown". */
export type PerRate = Record<number, { neto: number; iva: number }>;

function addRate(
  perRate: PerRate,
  key: number,
  neto: string | number,
  iva: string | number,
): void {
  const existing = perRate[key] ?? { neto: 0, iva: 0 };
  perRate[key] = {
    neto: existing.neto + Number(neto),
    iva: existing.iva + Number(iva),
  };
}

// AFIP iva_rate_id → rate. Mirror of lib/afip/codes.ts IVA_RATE_PERCENT
// (id 8 = 5%, id 9 = 2.5%); they used to be swapped here. Ascending order.
export const IVA_RATES = [
  { id: 3, pct: 0, label: "0%" },
  { id: 9, pct: 2.5, label: "2.5%" },
  { id: 8, pct: 5, label: "5%" },
  { id: 4, pct: 10.5, label: "10.5%" },
  { id: 5, pct: 21, label: "21%" },
  { id: 6, pct: 27, label: "27%" },
] as const;

/** A voucher as the books print it: letter, 4-digit point of sale and
 *  8-digit number ("A0001-00000042"). */
export function libroIvaVoucherNumber(row: {
  letter: string | null;
  punto_venta: number;
  numero: number;
}): string {
  return `${row.letter ?? ""}${String(row.punto_venta).padStart(4, "0")}-${String(row.numero).padStart(8, "0")}`;
}

export const KIND_LABEL: Record<string, string> = {
  factura: "Factura",
  nc: "Nota de crédito",
  nd: "Nota de débito",
};

/**
 * Groups the rows returned by the RPC into a "per voucher" view to build the
 * traditional IVA ledger format: one row per voucher with cells per rate.
 */
export type LibroIvaVentasGroupedRow = {
  invoice_id: string;
  fecha: string;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
  cbte_tipo_afip: number | null;
  client_legal_name: string;
  doc_tipo: number;
  doc_nro: string;
  cae: string | null;
  cae_vencimiento: string | null;
  imp_trib: number;
  imp_op_ex: number;
  imp_tot_conc: number;
  imp_total: number;
  channel_name: string;
  channel_id: string;
  has_items: boolean;
  /** Pesos: the document's amounts × its cotizacion (the book's figures). */
  per_rate: PerRate;
  moneda: string;
  cotizacion: number;
  /** The same figures in the document's own currency (Libro IVA Digital TXT). */
  orig: {
    per_rate: PerRate;
    imp_trib: number;
    imp_op_ex: number;
    imp_tot_conc: number;
    imp_total: number;
  };
};

export function groupByInvoice(
  rows: readonly LibroIvaVentasRow[],
): LibroIvaVentasGroupedRow[] {
  const map = new Map<string, LibroIvaVentasGroupedRow>();
  for (const r of rows) {
    let acc = map.get(r.invoice_id);
    if (!acc) {
      acc = {
        invoice_id: r.invoice_id,
        fecha: r.fecha,
        kind: r.kind,
        letter: r.letter,
        punto_venta: r.punto_venta,
        numero: r.numero,
        cbte_tipo_afip: r.cbte_tipo_afip,
        client_legal_name: r.client_legal_name,
        doc_tipo: r.doc_tipo,
        doc_nro: r.doc_nro,
        cae: r.cae,
        cae_vencimiento: r.cae_vencimiento,
        imp_trib: Number(r.imp_trib),
        imp_op_ex: Number(r.imp_op_ex),
        imp_tot_conc: Number(r.imp_tot_conc),
        imp_total: Number(r.imp_total),
        channel_name: r.channel_name,
        channel_id: r.channel_id,
        has_items: r.has_items,
        per_rate: {},
        moneda: r.moneda,
        cotizacion: Number(r.cotizacion),
        orig: {
          per_rate: {},
          imp_trib: Number(r.imp_trib_orig),
          imp_op_ex: Number(r.imp_op_ex_orig),
          imp_tot_conc: Number(r.imp_tot_conc_orig),
          imp_total: Number(r.imp_total_orig),
        },
      };
      map.set(r.invoice_id, acc);
    }
    const key = r.iva_rate_id ?? -1;
    addRate(acc.per_rate, key, r.neto, r.iva);
    addRate(acc.orig.per_rate, key, r.neto_orig, r.iva_orig);
  }
  return Array.from(map.values());
}

export type LibroIvaVentasTotals = {
  count: number;
  per_rate: Record<number, { neto: number; iva: number }>;
  imp_trib: number;
  imp_op_ex: number;
  imp_tot_conc: number;
  imp_total: number;
};

export function computeTotals(
  grouped: readonly LibroIvaVentasGroupedRow[],
): LibroIvaVentasTotals {
  const totals: LibroIvaVentasTotals = {
    count: grouped.length,
    per_rate: {},
    imp_trib: 0,
    imp_op_ex: 0,
    imp_tot_conc: 0,
    imp_total: 0,
  };
  for (const row of grouped) {
    // Notas de crédito reduce the IVA débito: subtract them from the totals.
    // The RPC returns NC amounts as positive with kind='nc'.
    const sign = row.kind === "nc" ? -1 : 1;
    for (const [k, v] of Object.entries(row.per_rate)) {
      const id = Number(k);
      const existing = totals.per_rate[id] ?? { neto: 0, iva: 0 };
      totals.per_rate[id] = {
        neto: existing.neto + sign * v.neto,
        iva: existing.iva + sign * v.iva,
      };
    }
    totals.imp_trib += sign * row.imp_trib;
    totals.imp_op_ex += sign * row.imp_op_ex;
    totals.imp_tot_conc += sign * row.imp_tot_conc;
    totals.imp_total += sign * row.imp_total;
  }
  return totals;
}

/** A foreign-currency document's contribution to the book, per currency. */
export type ForeignCurrencyTotal = {
  moneda: string;
  count: number;
  /** Signed (NC subtract), in the document currency. */
  imp_total_orig: number;
  /** Signed (NC subtract), in pesos at each document's cotizacion. */
  imp_total_ars: number;
};

type CurrencyDoc = {
  kind: string;
  moneda: string;
  cotizacion: number;
  imp_total: number;
  orig: { imp_total: number };
};

/**
 * Foreign-currency documents grouped by currency, so the page can show what
 * the peso totals include. Pesos ("PES") are left out: they need no note.
 */
export function foreignCurrencyTotals(
  docs: readonly CurrencyDoc[],
): ForeignCurrencyTotal[] {
  const map = new Map<string, ForeignCurrencyTotal>();
  for (const d of docs) {
    if (d.moneda === "PES") continue;
    const sign = d.kind === "nc" ? -1 : 1;
    const acc = map.get(d.moneda) ?? {
      moneda: d.moneda,
      count: 0,
      imp_total_orig: 0,
      imp_total_ars: 0,
    };
    acc.count += 1;
    acc.imp_total_orig = round2(acc.imp_total_orig + sign * d.orig.imp_total);
    acc.imp_total_ars = round2(acc.imp_total_ars + sign * d.imp_total);
    map.set(d.moneda, acc);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.moneda.localeCompare(b.moneda),
  );
}

/** Foreign-currency documents whose cotizacion is missing or 1: converting
 *  them leaves the amount at face value, so the accountant must check them. */
export function countSuspectRates(docs: readonly CurrencyDoc[]): number {
  return docs.filter((d) => d.moneda !== "PES" && d.cotizacion <= 1).length;
}
