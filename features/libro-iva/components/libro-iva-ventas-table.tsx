"use client";

import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";

import { useLibroIvaVentas } from "../hooks/use-libro-iva";
import { CONDITION_LEGEND, TC_LEGEND, ventasBook } from "../lib/book-layout";

import { BookReadError } from "./book-read-error";
import { CurrencyNote } from "./currency-note";
import { hasItemlessNote, ItemlessNote } from "./itemless-note";
import { LibroIvaBookTable, LibroIvaBookTitle } from "./libro-iva-book-table";
import { LibroIvaExportButtons } from "./libro-iva-export-buttons";

export function LibroIvaVentasTable({
  period,
  channelId,
}: {
  period: string;
  channelId: string | null;
}) {
  const {
    data: rows,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useLibroIvaVentas(period, channelId);

  const model = useMemo(() => ventasBook(rows ?? []), [rows]);
  const sinCae = model.docs.filter((d) => !d.cae).length;

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  // A failed refetch keeps the book already read; a failed first read is
  // not an empty period.
  if (error && !rows) {
    return (
      <BookReadError
        error={error}
        retrying={isFetching}
        onRetry={() => void refetch()}
      />
    );
  }

  if (model.docs.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No hay comprobantes emitidos fiscales para este período.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(sinCae > 0 || hasItemlessNote(model.grouped)) && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            {sinCae > 0 && (
              <p>
                <span className="font-medium">{sinCae}</span> comprobante(s){" "}
                <span className="font-medium">sin CAE</span> en el período. La
                presentación a AFIP los va a rechazar.
              </p>
            )}
            <ItemlessNote docs={model.grouped} />
          </div>
        </div>
      )}

      <CurrencyNote docs={model.grouped} />

      <LibroIvaBookTitle book="ventas" period={period} channelId={channelId} />

      <LibroIvaBookTable model={model} href={(id) => `/invoices/${id}`} />

      <p className="text-xs text-muted-foreground">
        {TC_LEGEND} {CONDITION_LEGEND}
      </p>

      <LibroIvaExportButtons
        book="ventas"
        period={period}
        channelId={channelId}
      />
    </div>
  );
}
