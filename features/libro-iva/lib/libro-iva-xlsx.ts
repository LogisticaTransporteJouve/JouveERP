import type { XlsxCell, XlsxColumn, XlsxSheet } from "@/lib/export/xlsx";

import {
  groupByInvoice,
  groupComprasByInvoice,
  IVA_RATES,
  KIND_LABEL,
  libroIvaVoucherNumber,
  type LibroIvaComprasRow,
  type LibroIvaVentasRow,
} from "../schema";

type Book = { period: string; channelName: string; generatedAt: string };

type Voucher = {
  fecha: string;
  kind: string;
  letter: string | null;
  punto_venta: number;
  numero: number;
  per_rate: Record<number, { neto: number; iva: number }>;
  imp_trib: number;
  imp_total: number;
};

/** One amount column: which value it reads and when the PDF prints it. */
type Amount<V> = {
  header: string;
  value: (v: V) => number | undefined;
  /** When the PDF prints it: always (Total), only when positive (Perc.,
   *  No grav.) or, by default, when not zero. */
  show?: "always" | "positive";
};

const ars = (n: number): XlsxCell => ({ money: n, currency: "ARS" });

function rateAmounts<V extends Voucher>(): Amount<V>[] {
  return IVA_RATES.flatMap((r) => [
    { header: `Neto ${r.label}`, value: (v: V) => v.per_rate[r.id]?.neto },
    { header: `IVA ${r.label}`, value: (v: V) => v.per_rate[r.id]?.iva },
  ]);
}

/**
 * A libro IVA as one sheet: the PDF's header lines, one row per voucher and
 * the same columns. Credit notes are written negative (the books store them
 * positive with kind `nc`), so each column's =SUM() matches the totals row,
 * which adds exactly the cells written above it.
 */
function bookSheet<V extends Voucher>(
  book: Book,
  title: string,
  vouchers: readonly V[],
  lead: {
    party: string;
    name: (v: V) => string;
    cuit: (v: V) => string | null;
  },
  amounts: readonly Amount<V>[],
  cae: { header: string; value: (v: V) => string | null },
): XlsxSheet {
  const sums = amounts.map(() => 0);
  const rows = vouchers.map((v) => {
    const sign = v.kind === "nc" ? -1 : 1;
    const cells = amounts.map((a, i): XlsxCell => {
      const raw = a.value(v) ?? 0;
      const hidden =
        a.show === "always" ? false : a.show === "positive" ? raw <= 0 : !raw;
      if (hidden) return null;
      sums[i] = (sums[i] ?? 0) + sign * raw;
      return ars(sign * raw);
    });
    return [
      { date: v.fecha },
      KIND_LABEL[v.kind] ?? v.kind,
      libroIvaVoucherNumber(v),
      lead.name(v),
      lead.cuit(v),
      ...cells,
      cae.value(v),
    ];
  });

  return {
    name: `${title} ${book.period}`,
    preamble: [
      `${title} — ${book.period}`,
      book.channelName,
      `${vouchers.length} comprobantes`,
      `Generado el ${book.generatedAt}`,
    ],
    columns: [
      { header: "Fecha", type: "date" },
      { header: "Tipo" },
      { header: "Comprobante" },
      { header: lead.party },
      { header: "CUIT" },
      ...amounts.map((a): XlsxColumn => ({ header: a.header, type: "money" })),
      { header: cae.header },
    ],
    rows,
    totals: [
      `Totales (${vouchers.length} comprobantes)`,
      null,
      null,
      null,
      null,
      ...sums.map((sum, i) =>
        // A column with no value written keeps its total empty, as the PDF.
        rows.some((r) => r[5 + i] !== null) ? ars(sum) : null,
      ),
      null,
    ],
  };
}

/** Libro IVA Ventas, same columns as its PDF. */
export function libroIvaVentasSheet(
  book: Book & { rows: readonly LibroIvaVentasRow[] },
): XlsxSheet {
  type V = ReturnType<typeof groupByInvoice>[number];
  return bookSheet<V>(
    book,
    "Libro IVA Ventas",
    groupByInvoice(book.rows),
    {
      party: "Cliente",
      name: (v) => v.client_legal_name,
      cuit: (v) => v.doc_nro,
    },
    [
      ...rateAmounts<V>(),
      { header: "Perc.", value: (v) => v.imp_trib, show: "positive" },
      { header: "No grav.", value: (v) => v.imp_op_ex, show: "positive" },
      { header: "Total", value: (v) => v.imp_total, show: "always" },
    ],
    { header: "CAE", value: (v) => v.cae },
  );
}

/** Libro IVA Compras, same columns as its PDF. */
export function libroIvaComprasSheet(
  book: Book & { rows: readonly LibroIvaComprasRow[] },
): XlsxSheet {
  type V = ReturnType<typeof groupComprasByInvoice>[number];
  return bookSheet<V>(
    book,
    "Libro IVA Compras",
    groupComprasByInvoice(book.rows),
    {
      party: "Proveedor",
      name: (v) => v.supplier_legal_name,
      cuit: (v) => v.supplier_cuit,
    },
    [
      ...rateAmounts<V>(),
      { header: "Perc.", value: (v) => v.imp_trib, show: "positive" },
      { header: "Total", value: (v) => v.imp_total, show: "always" },
    ],
    { header: "CAE prov.", value: (v) => v.cae_proveedor },
  );
}
