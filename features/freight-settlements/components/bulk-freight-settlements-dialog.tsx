"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
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
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<FreightBulkResult | null>(null);
  const mut = useCreateFreightSettlementsBulk();

  function close(next: boolean) {
    // Its result belongs to this run: closing mid-run would show it on the
    // next one.
    if (!next && mut.isPending) return;
    if (!next) setResult(null);
    onOpenChange(next);
  }

  function onSubmit() {
    mut.mutate(
      { period_start: start, period_end: end, confirm },
      {
        onSuccess: (data) => {
          setResult(data);
          if (data.created.length === 0) {
            toast.info("No se creó ninguna liquidación.");
          } else {
            toast.success(
              data.created.length === 1
                ? "Se creó 1 liquidación."
                : `Se crearon ${data.created.length} liquidaciones.`,
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
            Arma una liquidación por cliente con sus cargas entregadas del
            período que no están facturadas ni en otra liquidación. Quedan en
            borrador para revisarlas, o confirmadas si lo elegís.
          </DialogDescription>
        </DialogHeader>

        {result === null ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm sm:col-span-2 sm:order-last">
              <Checkbox
                className="mt-0.5"
                checked={confirm}
                onCheckedChange={(v) => setConfirm(v === true)}
              />
              <span>
                Confirmarlas: cada cliente de Ventas recibe su remito R; las de
                Otras ventas quedan confirmadas para emitir su remito interno X
                una por una.
              </span>
            </label>
            <div className="space-y-2">
              <Label htmlFor="fs-bulk-start">Desde</Label>
              <DatePicker
                id="fs-bulk-start"
                value={start}
                onChange={setStart}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fs-bulk-end">Hasta</Label>
              <DatePicker id="fs-bulk-end" value={end} onChange={setEnd} />
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
                        {c.remito ? ` · Remito ${c.remito}` : ""}
                        {c.unpriced > 0
                          ? ` · ${c.unpriced} sin precio quedaron afuera`
                          : ""}
                        {c.confirm_error ? ` · ${c.confirm_error}` : ""}
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
                disabled={mut.isPending}
                onClick={() => close(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={mut.isPending || start === "" || end === ""}
                onClick={onSubmit}
              >
                {mut.isPending
                  ? "Liquidando…"
                  : confirm
                    ? "Crear y confirmar"
                    : "Crear borradores"}
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
