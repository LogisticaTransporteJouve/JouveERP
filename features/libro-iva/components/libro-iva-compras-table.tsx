"use client";

import { AlertTriangle, FileDown } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatArgentineDate, formatNumber2 as money } from "@/lib/format";

import { useLibroIvaCompras } from "../hooks/use-libro-iva";
import {
  computeComprasTotals,
  groupComprasByInvoice,
  IVA_RATES,
  KIND_LABEL,
} from "../schema";

export function LibroIvaComprasTable({
  period,
  channelId,
}: {
  period: string;
  channelId: string | null;
}) {
  const { data: rows } = useLibroIvaCompras(period, channelId);

  const grouped = useMemo(() => groupComprasByInvoice(rows), [rows]);
  const totals = useMemo(() => computeComprasTotals(grouped), [grouped]);

  const sinCae = grouped.filter((g) => !g.cae_proveedor).length;
  const sinItems = grouped.filter((g) => !g.has_items).length;

  if (grouped.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No hay compras recibidas fiscales para este período.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(sinCae > 0 || sinItems > 0) && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          <div className="space-y-1">
            {sinCae > 0 && (
              <p>
                <span className="font-medium">{sinCae}</span> comprobante(s){" "}
                <span className="font-medium">sin CAE del proveedor</span>.
                Verificá con el original antes de la presentación.
              </p>
            )}
            {sinItems > 0 && (
              <p>
                <span className="font-medium">{sinItems}</span> comprobante(s){" "}
                <span className="font-medium">sin desglose por alícuota</span>{" "}
                (probablemente legacy AFIP imports). El IVA total se muestra
                pero sin separar por tasa.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-xs">
            <tr>
              <th className="px-2 py-2 font-medium">Fecha</th>
              <th className="px-2 py-2 font-medium">Tipo</th>
              <th className="px-2 py-2 font-medium">Comprobante</th>
              <th className="px-2 py-2 font-medium">Proveedor</th>
              <th className="px-2 py-2 font-medium">CUIT</th>
              {IVA_RATES.map((r) => (
                <th key={r.id} colSpan={2} className="border-l px-2 py-2 text-center font-medium">
                  {r.label}
                </th>
              ))}
              <th className="border-l px-2 py-2 text-right font-medium">Perc.</th>
              <th className="px-2 py-2 text-right font-medium">Total</th>
              <th className="px-2 py-2 font-medium">CAE prov.</th>
            </tr>
            <tr className="border-b text-xs text-muted-foreground">
              <th />
              <th />
              <th />
              <th />
              <th />
              {IVA_RATES.map((r) => (
                <Fragment key={r.id}>
                  <th className="border-l px-2 py-1 text-right font-normal">
                    Neto
                  </th>
                  <th className="px-2 py-1 text-right font-normal">
                    IVA
                  </th>
                </Fragment>
              ))}
              <th className="border-l" />
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {grouped.map((row) => {
              const number = `${row.letter ?? ""}${String(row.punto_venta).padStart(4, "0")}-${String(row.numero).padStart(8, "0")}`;
              return (
                <tr key={row.purchase_invoice_id} className="border-b last:border-b-0 hover:bg-muted/20">
                  <td className="px-2 py-1 font-mono text-xs text-muted-foreground">
                    {formatArgentineDate(row.fecha)}
                  </td>
                  <td className="px-2 py-1 text-xs">
                    <Badge variant="outline" className="text-xs font-normal">
                      {KIND_LABEL[row.kind] ?? row.kind}
                    </Badge>
                  </td>
                  <td className="px-2 py-1 font-mono text-xs">
                    <Link href={`/purchases/${row.purchase_invoice_id}`} className="hover:underline">
                      {number}
                    </Link>
                  </td>
                  <td className="px-2 py-1 max-w-[200px] truncate" title={row.supplier_legal_name}>
                    {row.supplier_legal_name}
                  </td>
                  <td className="px-2 py-1 font-mono text-xs text-muted-foreground">
                    {row.supplier_cuit ?? "—"}
                  </td>
                  {IVA_RATES.map((r) => {
                    const cell = row.per_rate[r.id];
                    return (
                      <Fragment key={r.id}>
                        <td className="border-l px-2 py-1 text-right font-mono text-xs">
                          {cell?.neto ? money(cell.neto) : ""}
                        </td>
                        <td className="px-2 py-1 text-right font-mono text-xs">
                          {cell?.iva ? money(cell.iva) : ""}
                        </td>
                      </Fragment>
                    );
                  })}
                  <td className="border-l px-2 py-1 text-right font-mono text-xs">
                    {row.imp_trib > 0 ? money(row.imp_trib) : ""}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-xs font-medium">
                    {money(row.imp_total)}
                  </td>
                  <td className="px-2 py-1 font-mono text-xs text-muted-foreground">
                    {row.cae_proveedor ? (
                      <span title={row.cae_vto_proveedor ? `Vto ${row.cae_vto_proveedor}` : ""}>
                        {row.cae_proveedor}
                      </span>
                    ) : (
                      <span className="text-amber-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 bg-muted/30 text-xs font-medium">
            <tr>
              <td colSpan={5} className="px-2 py-2 text-right">
                Totales ({totals.count} comprobantes)
              </td>
              {IVA_RATES.map((r) => {
                const cell = totals.per_rate[r.id];
                return (
                  <Fragment key={r.id}>
                    <td className="border-l px-2 py-2 text-right font-mono">
                      {cell?.neto ? money(cell.neto) : ""}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {cell?.iva ? money(cell.iva) : ""}
                    </td>
                  </Fragment>
                );
              })}
              <td className="border-l px-2 py-2 text-right font-mono">
                {totals.imp_trib > 0 ? money(totals.imp_trib) : ""}
              </td>
              <td className="px-2 py-2 text-right font-mono">{money(totals.imp_total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <a
            href={`/api/accounting/libro-iva-compras/pdf?period=${period}${channelId ? `&channel=${channelId}` : ""}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FileDown />
            Exportar PDF
          </a>
        </Button>
      </div>
    </div>
  );
}
