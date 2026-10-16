import type { XlsxCell, XlsxColumn, XlsxSheet } from "@/lib/export/xlsx";

import {
  computeComprasTotals,
  computeTotals,
  groupByInvoice,
  groupComprasByInvoice,
  IVA_RATES,
  KIND_LABEL,
  libroIvaVoucherNumber,
  type LibroIvaComprasRow,
  type LibroIvaVentasRow,
} from "../schema";

type Book = { period: string };

const ars = (n: number): XlsxCell => ({ money: n, currency: "ARS" });
const arsIfAny = (n: number | undefined): XlsxCell => (n ? ars(n) : null);

const LEAD_COLUMNS = (party: string): XlsxColumn[] => [
  { header: "Fecha", type: "date" },
  { header: "Tipo" },
  { header: "Comprobante" },
  { header: party },
  { header: "CUIT" },
];

const RATE_COLUMNS: XlsxColumn[] = IVA_RATES.flatMap((r) => [
  { header: `Neto ${r.label}`, type: "money" },
  { header: `IVA ${r.label}`, type: "money" },
]);

function rateCells(
  perRate: Record<number, { neto: number; iva: number }>,
): XlsxCell[] {
  return IVA_RATES.flatMap((r) => [
    arsIfAny(perRate[r.id]?.neto),
    arsIfAny(perRate[r.id]?.iva),
  ]);
}

/** Libro IVA Ventas as one sheet: one row per voucher, same columns and
 *  totals as the PDF. */
export function libroIvaVentasSheet(
  book: Book & { rows: readonly LibroIvaVentasRow[] },
): XlsxSheet {
  const grouped = groupByInvoice(book.rows);
  const totals = computeTotals(grouped);
  return {
    name: `IVA Ventas ${book.period}`,
    columns: [
      ...LEAD_COLUMNS("Cliente"),
      ...RATE_COLUMNS,
      { header: "Perc.", type: "money" },
      { header: "No grav.", type: "money" },
      { header: "Total", type: "money" },
      { header: "CAE" },
    ],
    rows: grouped.map((row) => [
      { date: row.fecha },
      KIND_LABEL[row.kind] ?? row.kind,
      libroIvaVoucherNumber(row),
      row.client_legal_name,
      row.doc_nro,
      ...rateCells(row.per_rate),
      arsIfAny(row.imp_trib),
      arsIfAny(row.imp_op_ex),
      ars(row.imp_total),
      row.cae,
    ]),
    totals: [
      `Totales (${totals.count} comprobantes)`,
      null,
      null,
      null,
      null,
      ...rateCells(totals.per_rate),
      arsIfAny(totals.imp_trib),
      arsIfAny(totals.imp_op_ex),
      ars(totals.imp_total),
      null,
    ],
  };
}

/** Libro IVA Compras as one sheet, same columns and totals as the PDF. */
export function libroIvaComprasSheet(
  book: Book & { rows: readonly LibroIvaComprasRow[] },
): XlsxSheet {
  const grouped = groupComprasByInvoice(book.rows);
  const totals = computeComprasTotals(grouped);
  return {
    name: `IVA Compras ${book.period}`,
    columns: [
      ...LEAD_COLUMNS("Proveedor"),
      ...RATE_COLUMNS,
      { header: "Perc.", type: "money" },
      { header: "Total", type: "money" },
      { header: "CAE prov." },
    ],
    rows: grouped.map((row) => [
      { date: row.fecha },
      KIND_LABEL[row.kind] ?? row.kind,
      libroIvaVoucherNumber(row),
      row.supplier_legal_name,
      row.supplier_cuit,
      ...rateCells(row.per_rate),
      arsIfAny(row.imp_trib),
      ars(row.imp_total),
      row.cae_proveedor,
    ]),
    totals: [
      `Totales (${totals.count} comprobantes)`,
      null,
      null,
      null,
      null,
      ...rateCells(totals.per_rate),
      arsIfAny(totals.imp_trib),
      ars(totals.imp_total),
      null,
    ],
  };
}
