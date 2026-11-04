"use client";

import Link from "next/link";

import { formatArgentineDate, formatNumber2 as money } from "@/lib/format";

import { useLibroIvaHeader } from "../hooks/use-libro-iva";
import {
  type AmountColumn,
  type BookModel,
  companyCuitLabel,
  kindSign,
  type LibroIvaBook,
  libroIvaTitle,
  tcCode,
  totalsAmount,
  voucherAmount,
  voucherLines,
} from "../lib/book-layout";

import { OriginalCurrencyCell } from "./currency-note";

/** The legacy title block: "Libro de I.V.A. … - Previo", company and CUIT. */
export function LibroIvaBookTitle({
  book,
  period,
  channelId,
}: {
  book: LibroIvaBook;
  period: string;
  channelId: string | null;
}) {
  const { data, error, isLoading } = useLibroIvaHeader(period, channelId);
  if (isLoading) return null;
  if (error || !data) {
    return (
      <p className="text-sm text-muted-foreground">
        No se pudo leer el encabezado del libro (empresa y estado del período).
      </p>
    );
  }
  return (
    <div className="space-y-1 border-b pb-2">
      <p className="text-center text-sm font-semibold">
        {libroIvaTitle(book, period, data.closed)}
      </p>
      <div className="flex justify-between gap-4 text-xs">
        <span>{data.companyName}</span>
        <span className="font-mono">{companyCuitLabel(data.cuit)}</span>
      </div>
    </div>
  );
}

/** Perception lines: amount and code ("5.115,78 B"), one per type. */
function Lines({
  entries,
}: {
  entries: readonly { code: string; amount: number }[];
}) {
  return entries.map((p) => (
    <div key={p.code} className="whitespace-nowrap">
      {money(p.amount)} {p.code}
    </div>
  ));
}

function AmountCell<F>({
  col,
  amount,
  lines,
  first,
}: {
  col: AmountColumn<F>;
  amount: number | null;
  lines: { code: string; amount: number }[];
  first: boolean;
}) {
  return (
    <td
      className={`${first ? "border-l " : ""}${col.key === "total" ? "font-medium " : ""}px-2 py-1 text-right font-mono text-xs`}
    >
      {col.lines ? (
        <Lines entries={lines} />
      ) : amount === null ? (
        ""
      ) : (
        money(amount)
      )}
    </td>
  );
}

/** One row per voucher: Fecha, TC, Comprobante, Razón social, CUIT, C.I.,
 *  the amount columns (NC negative), the original currency and the CAE. */
export function LibroIvaBookTable<F>({
  model,
  href,
}: {
  model: BookModel<F>;
  href: (id: string) => string;
}) {
  const { columns, docs, totals } = model;
  // A Neto/IVA pair starts a bordered group; so does the first single column.
  const startsGroup = (i: number) =>
    i === 0 || columns[i]?.group !== columns[i - 1]?.group;
  const groups = columns.reduce<{ label: string | null; span: number }[]>(
    (acc, c, i) => {
      const last = acc.at(-1);
      if (last && !startsGroup(i) && c.group !== null) last.span += 1;
      else acc.push({ label: c.group, span: 1 });
      return acc;
    },
    [],
  );

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30 text-left text-xs">
          <tr>
            <th colSpan={6} className="sticky left-0 z-10 bg-card" />
            {groups.map((g, i) => (
              <th
                key={i}
                colSpan={g.span}
                className="border-l px-2 py-1 text-center font-medium"
              >
                {g.label ?? ""}
              </th>
            ))}
            <th colSpan={2} />
          </tr>
          <tr>
            <th className="sticky left-0 z-10 bg-card px-2 py-2 font-medium">
              Fecha
            </th>
            <th className="px-2 py-2 font-medium">TC</th>
            <th className="px-2 py-2 font-medium">Comprobante</th>
            <th className="px-2 py-2 font-medium">{model.partyHeader}</th>
            <th className="px-2 py-2 font-medium">C.U.I.T.</th>
            <th className="px-2 py-2 font-medium">C.I.</th>
            {columns.map((c, i) => (
              <th
                key={c.key}
                className={`${startsGroup(i) ? "border-l " : ""}px-2 py-2 text-right font-medium`}
              >
                {c.header}
              </th>
            ))}
            <th className="px-2 py-2 text-right font-medium">Moneda orig.</th>
            <th className="px-2 py-2 font-medium">{model.caeHeader}</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr
              key={d.id}
              className="group border-b last:border-b-0 hover:bg-muted/20"
            >
              <td className="sticky left-0 z-10 bg-card px-2 py-1 font-mono text-xs text-muted-foreground group-hover:bg-muted/20">
                {formatArgentineDate(d.fecha)}
              </td>
              <td className="px-2 py-1 font-mono text-xs">{tcCode(d.kind)}</td>
              <td className="px-2 py-1 font-mono text-xs">
                <Link href={href(d.id)} className="hover:underline">
                  {d.number}
                </Link>
              </td>
              <td className="max-w-[200px] truncate px-2 py-1" title={d.party}>
                {d.party}
              </td>
              <td className="px-2 py-1 font-mono text-xs text-muted-foreground">
                {d.cuit || "—"}
              </td>
              <td className="px-2 py-1 font-mono text-xs">{d.ci ?? "—"}</td>
              {columns.map((c, i) => (
                <AmountCell
                  key={c.key}
                  col={c}
                  first={startsGroup(i)}
                  amount={voucherAmount(c, d.figures, d.kind)}
                  lines={voucherLines(c, d.figures, d.kind)}
                />
              ))}
              <td className="px-2 py-1 text-right font-mono text-xs">
                <OriginalCurrencyCell
                  moneda={d.moneda}
                  cotizacion={d.cotizacion}
                  impTotal={kindSign(d.kind) * d.origTotal}
                />
              </td>
              <td className="px-2 py-1 font-mono text-xs text-muted-foreground">
                {d.cae ? (
                  <span title={d.caeVto ? `Vto ${d.caeVto}` : ""}>{d.cae}</span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 bg-muted/30 text-xs font-medium">
          <tr>
            <td
              colSpan={6}
              className="sticky left-0 z-10 bg-card px-2 py-2 text-right"
            >
              Totales ({totals.count} comprobantes)
            </td>
            {columns.map((c, i) => (
              <AmountCell
                key={c.key}
                col={c}
                first={startsGroup(i)}
                amount={totalsAmount(c, totals)}
                lines={c.lines?.(totals) ?? []}
              />
            ))}
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
