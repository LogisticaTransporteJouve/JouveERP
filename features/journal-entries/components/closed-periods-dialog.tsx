"use client";

import { Lock, LockOpen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
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
import { Skeleton } from "@/components/ui/skeleton";
import { formatArgentineDateTime, formatPeriod } from "@/lib/format";

import {
  useCloseAccountingPeriod,
  useClosedPeriods,
  useReopenAccountingPeriod,
} from "../hooks/use-closed-periods";
import { currentPeriod } from "../schema";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Accounting periods closed to posting: close one more, or reopen one. A
 * closed period refuses every new, edited or reversed entry dated in it.
 */
export function ClosedPeriodsDialog({ open, onOpenChange }: Props) {
  const confirm = useConfirm();
  const [period, setPeriod] = useState(currentPeriod());
  const periods = useClosedPeriods(open);
  const closeMut = useCloseAccountingPeriod();
  const reopenMut = useReopenAccountingPeriod();

  const alreadyClosed = (periods.data ?? []).some((p) => p.period === period);

  async function onClose() {
    const ok = await confirm({
      title: `Cerrar ${formatPeriod(period)}`,
      description:
        "No se van a poder registrar, editar ni revertir asientos con fecha en ese mes hasta que lo reabras.",
      confirmLabel: "Cerrar período",
    });
    if (!ok) return;
    closeMut.mutate(period, {
      onSuccess: () => toast.success(`${formatPeriod(period)} cerrado.`),
      onError: (err) => toast.error(err.message),
    });
  }

  async function onReopen(target: string) {
    const ok = await confirm({
      title: `Reabrir ${formatPeriod(target)}`,
      description:
        "Se van a poder volver a registrar y modificar asientos con fecha en ese mes.",
      confirmLabel: "Reabrir",
      tone: "destructive",
    });
    if (!ok) return;
    reopenMut.mutate(target, {
      onSuccess: () => toast.success(`${formatPeriod(target)} reabierto.`),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Períodos cerrados</DialogTitle>
          <DialogDescription>
            Un período cerrado no admite asientos nuevos, ediciones ni reversas
            con fecha en ese mes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="cp-period">Período</Label>
            <Input
              id="cp-period"
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </div>
          <Button
            onClick={onClose}
            disabled={!period || alreadyClosed || closeMut.isPending}
          >
            <Lock />
            {closeMut.isPending ? "Cerrando…" : "Cerrar período"}
          </Button>
        </div>
        {alreadyClosed && (
          <p className="text-xs text-muted-foreground">
            {formatPeriod(period)} ya está cerrado.
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {periods.isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : periods.error ? (
            <p className="p-4 text-sm text-muted-foreground">
              {periods.error.message}
            </p>
          ) : (periods.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No hay períodos cerrados.
            </p>
          ) : (
            <ul className="divide-y">
              {(periods.data ?? []).map((p) => (
                <li
                  key={p.period}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize">
                      {formatPeriod(p.period)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Cerrado el {formatArgentineDateTime(p.closed_at)}
                      {p.note ? ` · ${p.note}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onReopen(p.period)}
                    disabled={reopenMut.isPending}
                  >
                    <LockOpen />
                    Reabrir
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Listo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
