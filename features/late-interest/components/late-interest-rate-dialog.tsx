"use client";

import { useEffect, useState } from "react";
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

import {
  useSetClientLateInterestRate,
  useSetLateInterestGeneralRate,
} from "../hooks/use-late-interest";

/** Which rate is being edited: the general one, or one client's. */
export type RateTarget =
  | { kind: "general"; current: number | null }
  | {
      kind: "client";
      clientId: string;
      clientName: string;
      current: number | null;
    };

export function LateInterestRateDialog({
  target,
  onClose,
}: {
  target: RateTarget | null;
  onClose: () => void;
}) {
  const open = target !== null;
  const generalMut = useSetLateInterestGeneralRate();
  const clientMut = useSetClientLateInterestRate();
  const pending = generalMut.isPending || clientMut.isPending;
  const [rate, setRate] = useState("");

  useEffect(() => {
    if (target) setRate(target.current === null ? "" : String(target.current));
  }, [target]);

  function save(value: number | null) {
    if (!target) return;
    const callbacks = {
      onSuccess: () => {
        toast.success("Tasa guardada.");
        onClose();
      },
      onError: (err: Error) => toast.error(err.message),
    };
    if (target.kind === "general") {
      generalMut.mutate({ monthly_rate: value }, callbacks);
    } else {
      clientMut.mutate(
        { client_id: target.clientId, monthly_rate: value },
        callbacks,
      );
    }
  }

  function onSubmit() {
    const n = Number(rate.replace(",", "."));
    if (rate.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) {
      toast.error("Ingresá una tasa mensual entre 0 y 100.");
      return;
    }
    save(n);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {target?.kind === "client"
              ? `Tasa de ${target.clientName}`
              : "Tasa general de mora"}
          </DialogTitle>
          <DialogDescription>
            {target?.kind === "client"
              ? "Interés mensual por mora de este cliente. Sin tasa propia se usa la general."
              : "Interés mensual por mora para los clientes sin tasa propia."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="li-rate-edit">Tasa mensual (%)</Label>
            <Input
              id="li-rate-edit"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              placeholder="Ej.: 3"
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={pending || target?.current === null}
              onClick={() => save(null)}
            >
              {target?.kind === "client" ? "Usar la general" : "Quitar tasa"}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                Guardar
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
