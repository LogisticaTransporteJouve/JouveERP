export const LIBRO_IVA_VENTAS_PATH = "/accounting/libro-iva-ventas";

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
};

export const IVA_RATES = [
  { id: 3, pct: 0, label: "0%" },
  { id: 8, pct: 2.5, label: "2.5%" },
  { id: 9, pct: 5, label: "5%" },
  { id: 4, pct: 10.5, label: "10.5%" },
  { id: 5, pct: 21, label: "21%" },
  { id: 6, pct: 27, label: "27%" },
] as const;

export const KIND_LABEL: Record<string, string> = {
  factura: "Factura",
  nc: "Nota de crédito",
  nd: "Nota de débito",
};

/**
 * Agrupa las filas devueltas por la RPC en una vista "por comprobante" para
 * armar el formato libro IVA tradicional: una fila por comprobante con
 * cells por alícuota.
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
  /** Neto + IVA por iva_rate_id (key). iva_rate_id = -1 representa "sin desglose" */
  per_rate: Record<number, { neto: number; iva: number }>;
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
      };
      map.set(r.invoice_id, acc);
    }
    const key = r.iva_rate_id ?? -1;
    const existing = acc.per_rate[key] ?? { neto: 0, iva: 0 };
    acc.per_rate[key] = {
      neto: existing.neto + Number(r.neto),
      iva: existing.iva + Number(r.iva),
    };
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
    for (const [k, v] of Object.entries(row.per_rate)) {
      const id = Number(k);
      const existing = totals.per_rate[id] ?? { neto: 0, iva: 0 };
      totals.per_rate[id] = {
        neto: existing.neto + v.neto,
        iva: existing.iva + v.iva,
      };
    }
    totals.imp_trib += row.imp_trib;
    totals.imp_op_ex += row.imp_op_ex;
    totals.imp_tot_conc += row.imp_tot_conc;
    totals.imp_total += row.imp_total;
  }
  return totals;
}
