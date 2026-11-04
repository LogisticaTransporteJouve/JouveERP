"use client";

import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";

import { useLibroIvaCompras } from "../hooks/use-libro-iva";
import { comprasBook, CONDITION_LEGEND, TC_LEGEND } from "../lib/book-layout";
import { COMPRAS_PERCEPTIONS_LEGEND } from "../schema";

import { CurrencyNote } from "./currency-note";
import { ItemlessNote } from "./itemless-note";
import { LibroIvaBookTable, LibroIvaBookTitle } from "./libro-iva-book-table";
import { LibroIvaExportButtons } from "./libro-iva-export-buttons";

export function LibroIvaComprasTable({
  period,
  channelId,
}: {
  period: string;
  channelId: string | null;
}) {
  const { data: rows, isLoading } = useLibroIvaCompras(period, channelId);

  const model = useMemo(() => comprasBook(rows ?? []), [rows]);
  const sinCae = model.docs.filter((d) => !d.cae).length;
  const sinItems = model.grouped.filter((g) => !g.has_items).length;

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  if (model.docs.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No hay compras recibidas fiscales para este período.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(sinCae > 0 || sinItems > 0) && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            {sinCae > 0 && (
              <p>
                <span className="font-medium">{sinCae}</span> comprobante(s){" "}
                <span className="font-medium">sin CAE del proveedor</span>.
                Verificá con el original antes de la presentación.
              </p>
            )}
            <ItemlessNote docs={model.grouped} />
          </div>
        </div>
      )}

      <CurrencyNote docs={model.grouped} />

      <LibroIvaBookTitle book="compras" period={period} channelId={channelId} />

      <LibroIvaBookTable model={model} href={(id) => `/purchases/${id}`} />

      <p className="text-xs text-muted-foreground">
        {COMPRAS_PERCEPTIONS_LEGEND} {TC_LEGEND} {CONDITION_LEGEND}
      </p>

      <LibroIvaExportButtons
        book="compras"
        period={period}
        channelId={channelId}
      />
    </div>
  );
}
