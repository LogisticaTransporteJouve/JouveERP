"use client";

import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { PairReconciliation } from "@/lib/afip/sync-issued";

import { useArcaReconciliation } from "../hooks/use-afip-admin";

const nf = new Intl.NumberFormat("es-AR");

export function ArcaReconciliationPanel() {
  const [requested, setRequested] = useState(false);
  const query = useArcaReconciliation(requested);
  const rows = query.data ?? [];
  const busy = query.isFetching;

  function run() {
    if (requested) void query.refetch();
    else setRequested(true);
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">Conciliación con ARCA</h2>
          <p className="text-xs text-muted-foreground">
            ARCA numera cada tipo de comprobante sin saltos: del 1 al último
            autorizado tiene que estar todo en el ERP.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={run} disabled={busy}>
          <RefreshCw className={busy ? "animate-spin" : undefined} />
          {busy ? "Consultando ARCA…" : "Conciliar con ARCA"}
        </Button>
      </div>

      {query.isError ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {query.error.message}
        </p>
      ) : !requested || (busy && rows.length === 0) ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {busy
            ? "Consultando el último número de cada tipo en ARCA…"
            : "Tocá “Conciliar con ARCA” para comparar lo importado contra ARCA."}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No hay puntos de venta fiscales habilitados para conciliar.
        </p>
      ) : (
        <>
          <Summary rows={rows} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">PV</th>
                  <th className="px-4 py-2 text-left font-medium">Tipo</th>
                  <th className="px-4 py-2 text-right font-medium">
                    Último en ARCA
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Último en el ERP
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Por importar
                  </th>
                  <th className="px-4 py-2 text-right font-medium">Huecos</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Números faltantes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <ReconciliationRow
                    key={`${r.punto_venta}-${r.cbte_tipo}`}
                    row={r}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Summary({ rows }: { rows: PairReconciliation[] }) {
  const notImported = rows.reduce((n, r) => n + r.not_imported_yet, 0);
  const gaps = rows.reduce((n, r) => n + r.gaps, 0);
  const complete = notImported === 0 && gaps === 0;
  const Icon = complete ? CheckCircle2 : TriangleAlert;
  return (
    <div className="flex items-start gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>
        {complete
          ? "Todo conciliado: el ERP tiene cada comprobante que ARCA autorizó."
          : `Faltan ${nf.format(notImported + gaps)} comprobantes: ${nf.format(notImported)} todavía no llegaron a importarse y ${nf.format(gaps)} son huecos: números que el ERP no tiene por debajo del último importado (por ejemplo, NC/ND que esperan su factura de origen).`}
      </p>
    </div>
  );
}

function ReconciliationRow({ row }: { row: PairReconciliation }) {
  const pending = row.not_imported_yet + row.gaps > 0;
  return (
    <tr className={pending ? undefined : "text-muted-foreground"}>
      <td className="px-4 py-2 font-mono">
        {String(row.punto_venta).padStart(5, "0")}
      </td>
      <td className="px-4 py-2">{row.label}</td>
      <td className="px-4 py-2 text-right font-mono">
        {nf.format(row.last_authorized)}
      </td>
      <td className="px-4 py-2 text-right font-mono">
        {nf.format(row.last_local)}
      </td>
      <td className="px-4 py-2 text-right font-mono">
        {row.not_imported_yet > 0 ? nf.format(row.not_imported_yet) : "—"}
      </td>
      <td className="px-4 py-2 text-right font-mono">
        {row.gaps > 0 ? nf.format(row.gaps) : "—"}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
        {row.gap_sample.length > 0
          ? `${row.gap_sample.join(", ")}${row.gaps > row.gap_sample.length ? "…" : ""}`
          : "—"}
      </td>
    </tr>
  );
}
