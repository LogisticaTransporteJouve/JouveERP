"use client";

import { useEffect, useMemo, useState } from "react";
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

import { useIncreaseStorageTariffs } from "../hooks/use-storage-tariffs";
import type { StorageTariff } from "../schema";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Bulk % increase: every tariff in effect at the chosen date gets a new
 * open-ended row (rate + carga/descarga × factor) and the old one closes the
 * day before — the history stays queryable in the same table.
 */
export function IncreaseTariffsDialog({
  tariffs,
  open,
  onOpenChange,
}: {
  tariffs: StorageTariff[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [percent, setPercent] = useState("");
  const [validFrom, setValidFrom] = useState(todayISO());
  const increaseMut = useIncreaseStorageTariffs();

  useEffect(() => {
    if (open) {
      setPercent("");
      setValidFrom(todayISO());
    }
  }, [open]);

  const affected = useMemo(
    () =>
      tariffs.filter(
        (t) =>
          t.is_active &&
          t.valid_from < validFrom &&
          (t.valid_to === null || t.valid_to >= validFrom),
      ),
    [tariffs, validFrom],
  );

  const pct = Number(percent.replace(",", "."));
  const valid = Number.isFinite(pct) && pct !== 0 && pct > -100 && validFrom !== "";

  function onSubmit() {
    increaseMut.mutate(
      { percent: pct, valid_from: validFrom },
      {
        onSuccess: (data) => {
          toast.success(
            `${data.updated} tarifa(s) actualizadas${data.skipped > 0 ? ` (${data.skipped} salteadas por vigencia futura)` : ""}.`,
          );
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aumentar tarifas</DialogTitle>
          <DialogDescription>
            Se crea una tarifa nueva por cada vigente (tarifa y carga/descarga
            ajustadas por el porcentaje) y la anterior se cierra el día
            anterior. El historial queda en la tabla.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="inc-pct">Porcentaje</Label>
            <Input
              id="inc-pct"
              inputMode="decimal"
              placeholder="15"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inc-from">Vigente desde</Label>
            <Input
              id="inc-from"
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </div>
        </div>

        <p className="text-muted-foreground text-sm">
          {affected.length === 0
            ? "No hay tarifas vigentes anteriores a esa fecha."
            : `Afecta ${affected.length} tarifa(s): ${affected
                .map((t) => t.client?.legal_name ?? "General")
                .join(", ")}.`}
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!valid || affected.length === 0 || increaseMut.isPending}
          >
            Aplicar aumento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
