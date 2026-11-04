import type { XlsxCell, XlsxColumn, XlsxSheet } from "@/lib/export/xlsx";

import { formatNumber2 } from "@/lib/format";

import {
  COMPRAS_PERCEPTIONS_LEGEND,
  type LibroIvaComprasRow,
  type LibroIvaVentasRow,
} from "../schema";

import {
  bookNotes,
  type BookModel,
  companyCuitLabel,
  comprasBook,
  CONDITION_LEGEND,
  kindSign,
  type LibroIvaHeader,
  libroIvaTitle,
  printCurrency,
  TC_LEGEND,
  tcCode,
  ventasBook,
  voucherAmount,
  voucherLines,
} from "./book-layout";

type Book = {
  period: string;
  channelName: string;
  generatedAt: string;
  header: LibroIvaHeader;
};

const ars = (n: number): XlsxCell => ({ money: n, currency: "ARS" });

/** "Neto 21%" for a rate pair, the plain header otherwise. */
const amountHeader = (c: { group: string | null; header: string }) =>
  c.group ? `${c.header} ${c.group}` : c.header;

const LEAD_COLUMNS = 6;

/**
 * A libro IVA as one sheet: the PDF's title block, one row per voucher and
 * the same columns. Credit notes are written negative (the books store them
 * positive with kind `nc`), so each column's =SUM() matches the totals row,
 * which adds exactly the cells written above it and equals the period totals.
 */
function bookSheet<F>(
  book: Book,
  model: BookModel<F>,
  legend: readonly string[],
): XlsxSheet {
  const { columns, docs } = model;
  const sums = columns.map(() => 0);
  const perceptions = columns.find((c) => c.lines);
  const rows = docs.map((d) => {
    const cells = columns.map((c, i): XlsxCell => {
      const v = voucherAmount(c, d.figures, d.kind);
      if (v === null) return null;
      sums[i] = (sums[i] ?? 0) + v;
      return ars(v);
    });
    const foreign = d.moneda !== "PES";
    return [
      { date: d.fecha },
      tcCode(d.kind),
      d.number,
      d.party,
      d.cuit || null,
      d.ci,
      ...cells,
      d.moneda,
      foreign
        ? {
            money: kindSign(d.kind) * d.origTotal,
            currency: printCurrency(d.moneda),
          }
        : null,
      foreign ? d.cotizacion : null,
      d.cae,
      ...(perceptions
        ? [
            voucherLines(perceptions, d.figures, d.kind)
              .map((p) => `${formatNumber2(p.amount)} ${p.code}`)
              .join(" · ") || null,
          ]
        : []),
    ];
  });

  const title = libroIvaTitle(model.book, book.period, book.header.closed);
  return {
    name: `Libro IVA ${model.book === "ventas" ? "Ventas" : "Compras"} ${book.period}`,
    preamble: [
      title,
      [book.header.companyName, companyCuitLabel(book.header.cuit)]
        .filter(Boolean)
        .join(" · "),
      book.channelName,
      `${docs.length} comprobantes`,
      `Generado el ${book.generatedAt}`,
      ...bookNotes(model, legend),
    ],
    columns: [
      { header: "Fecha", type: "date" },
      { header: "TC" },
      { header: "Comprobante" },
      { header: model.partyHeader },
      { header: "C.U.I.T." },
      { header: "C.I." },
      ...columns.map((c): XlsxColumn => ({
        header: amountHeader(c),
        type: "money",
      })),
      { header: "Moneda orig." },
      { header: "Importe orig.", type: "money" },
      { header: "Cotización", type: "number" },
      { header: model.caeHeader },
      ...(perceptions ? [{ header: "Detalle percepciones" }] : []),
    ],
    rows,
    totals: [
      `Totales (${docs.length} comprobantes)`,
      ...Array.from({ length: LEAD_COLUMNS - 1 }, () => null),
      ...sums.map((sum, i) =>
        // A column with no value written keeps its total empty, as the PDF.
        rows.some((r) => r[LEAD_COLUMNS + i] !== null) ? ars(sum) : null,
      ),
      // Original amounts mix currencies: no total.
      null,
      null,
      null,
      null,
      ...(perceptions ? [null] : []),
    ],
  };
}

/** Libro IVA Ventas, same columns as its PDF. */
export function libroIvaVentasSheet(
  book: Book & { rows: readonly LibroIvaVentasRow[] },
): XlsxSheet {
  return bookSheet(book, ventasBook(book.rows), [TC_LEGEND, CONDITION_LEGEND]);
}

/** Libro IVA Compras, same columns as its PDF. */
export function libroIvaComprasSheet(
  book: Book & { rows: readonly LibroIvaComprasRow[] },
): XlsxSheet {
  return bookSheet(book, comprasBook(book.rows), [
    COMPRAS_PERCEPTIONS_LEGEND,
    TC_LEGEND,
    CONDITION_LEGEND,
  ]);
}
