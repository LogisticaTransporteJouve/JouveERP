"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, todayInAR } from "@/lib/format";

import { useCreateFreightSettlementsBulk } from "../hooks/use-freight-settlements-bulk";
import type { FreightBulkResult } from "../lib/bulk";

/** First and last day of the month before `today` (YYYY-MM-DD). */
function previousMonth(today: string): { start: string; end: string } {
  const [y, m] = today.split("-").map(Number);
  const year = m === 1 ? (y ?? 0) - 1 : (y ?? 0);
  const month = m === 1 ? 12 : (m ?? 1) - 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${last}` };
}

/** "Liquidar período": a draft per client with cargas to settle. */
export function BulkFreightSettlementsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const initial = previousMonth(todayInAR());
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [result, setResult] = useState<FreightBulkResult | null>(null);
  const mut = useCreateFreightSettlementsBulk();

  function close(next: boolean) {
    if (!next) setResult(null);
    onOpenChange(next);
  }

  function onSubmit() {
    mut.mutate(
      { period_start: start, period_end: end },
      {
        onSuccess: (data) => {
          setResult(data);
          if (data.created.length === 0) {
            toast.info("No se creó ninguna liquidación.");
          } else {
            toast.success(
              data.created.length === 1
                ? "Se creó 1 liquidación en borrador."
                : `Se crearon ${data.created.length} liquidaciones en borrador.`,
            );
          }
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Liquidar período</DialogTitle>
          <DialogDescription>
            Arma una liquidación en borrador por cliente con sus cargas
            entregadas del período que no están facturadas ni en otra
            liquidación. Después revisás y confirmás cada una.
          </DialogDescription>
        </DialogHeader>

        {result === null ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fs-bulk-start">Desde</Label>
              <Input
                id="fs-bulk-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fs-bulk-end">Hasta</Label>
              <Input
                id="fs-bulk-end"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {result.created.length > 0 && (
              <ul className="max-h-60 divide-y overflow-y-auto rounded-md border">
                {result.created.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-start justify-between gap-3 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {c.client_name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {c.cargas} cargas
                        {c.unpriced > 0
                          ? ` · ${c.unpriced} sin precio quedaron afuera`
                          : ""}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatMoney(c.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {result.skipped.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">Sin liquidación</p>
                <ul className="space-y-1 text-muted-foreground">
                  {result.skipped.map((s) => (
                    <li key={s.client_name}>
                      {s.client_name}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.created.length === 0 && result.skipped.length === 0 && (
              <p className="text-muted-foreground">
                No hay cargas para liquidar en el período.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {result === null ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => close(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={mut.isPending || start === "" || end === ""}
                onClick={onSubmit}
              >
                {mut.isPending ? "Liquidando…" : "Crear borradores"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => close(false)}>
              Listo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
