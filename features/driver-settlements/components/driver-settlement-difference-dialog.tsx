"use client";

import { Building2, UserRound } from "lucide-react";
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
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { usePostDriverSettlementDifference } from "../hooks/use-driver-settlements";
import type { DifferenceChargedTo, DriverSettlement } from "../schema";

type Option = {
  value: DifferenceChargedTo;
  title: string;
  description: string;
  /** Why it cannot be chosen, if it cannot. */
  blocked: string | null;
};

function options(
  s: DriverSettlement,
  canChargeDriver: boolean,
): readonly Option[] {
  const short = s.difference < 0;
  const amount = formatMoney(Math.abs(s.difference));
  const driverBlocked = !short
    ? "El sobrante ya quedó a cuenta del cliente en su recibo."
    : !canChargeDriver
      ? "Necesitás permiso de escritura en RRHH."
      : s.driver_employee_id === null
        ? "El chofer no está vinculado a un empleado (Flota › Choferes)."
        : null;
  return [
    {
      value: "driver",
      title: "A cargo del chofer",
      description: `Se emite un recibo que salda el faltante de ${amount} en la cuenta del cliente, y se carga como adelanto en la cuenta corriente de ${s.driver_name}.`,
      blocked: driverBlocked,
    },
    {
      value: "client",
      title: "A cargo del cliente",
      description: short
        ? `El faltante de ${amount} queda abierto en la cuenta del cliente. No se toca la cuenta corriente del chofer.`
        : `El sobrante de ${amount} queda a cuenta del cliente. No se toca la cuenta corriente del chofer.`,
      blocked: null,
    },
  ];
}

/** "Resolver diferencia": the driver or the client bears it, never both. */
export function DriverSettlementDifferenceDialog({
  settlement,
  canChargeDriver,
  onOpenChange,
}: {
  settlement: DriverSettlement | null;
  /** hr:write: the driver's option writes his employee account. */
  canChargeDriver: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={settlement !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {settlement && (
          <DifferenceForm
            key={settlement.id}
            settlement={settlement}
            canChargeDriver={canChargeDriver}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DifferenceForm({
  settlement: s,
  canChargeDriver,
  onDone,
}: {
  settlement: DriverSettlement;
  canChargeDriver: boolean;
  onDone: () => void;
}) {
  const mut = usePostDriverSettlementDifference();
  const opts = options(s, canChargeDriver);
  const [choice, setChoice] = useState<DifferenceChargedTo | null>(
    opts.find((o) => o.blocked === null)?.value ?? null,
  );

  function submit() {
    if (choice === null) return;
    mut.mutate(
      { id: s.id, charged_to: choice },
      {
        onSuccess: () => {
          toast.success(
            choice === "driver"
              ? "Diferencia a cargo del chofer: cliente saldado y adelanto en su cuenta corriente."
              : "Diferencia a cargo del cliente.",
          );
          onDone();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Resolver diferencia</DialogTitle>
        <DialogDescription>
          {s.driver_name} entregó {s.difference < 0 ? "de menos" : "de más"}{" "}
          {formatMoney(Math.abs(s.difference))}. Elegí quién la debe: queda en
          una sola cuenta.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2" role="radiogroup" aria-label="A cargo de">
        {opts.map((o) => {
          const selected = choice === o.value;
          const Icon = o.value === "driver" ? UserRound : Building2;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={o.blocked !== null || mut.isPending}
              onClick={() => setChoice(o.value)}
              className={cn(
                "flex w-full items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
                "disabled:cursor-not-allowed disabled:opacity-60",
                selected ? "border-primary bg-accent" : "hover:bg-accent/50",
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 space-y-1">
                <span className="block font-medium">{o.title}</span>
                <span className="block text-muted-foreground">
                  {o.blocked ?? o.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={mut.isPending}>
          Volver
        </Button>
        <Button onClick={submit} disabled={choice === null || mut.isPending}>
          {mut.isPending ? "Guardando…" : "Confirmar"}
        </Button>
      </DialogFooter>
    </>
  );
}
