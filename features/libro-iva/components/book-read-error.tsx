"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/** A failed book read: never shown as an empty period, and with no PDF or
 *  Excel export, since there is no book to export. */
export function BookReadError({
  error,
  retrying,
  onRetry,
}: {
  error: Error;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-12 text-center text-sm"
    >
      <AlertTriangle className="size-5 text-muted-foreground" />
      <p className="font-medium">No se pudo leer el libro del período.</p>
      <p className="text-muted-foreground">{error.message}</p>
      <p className="text-xs text-muted-foreground">
        Exportar PDF y Excel no está disponible hasta que el libro se pueda
        leer.
      </p>
      <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
        <RotateCw />
        {retrying ? "Reintentando…" : "Reintentar"}
      </Button>
    </div>
  );
}
