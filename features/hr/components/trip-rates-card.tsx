"use client";

import { Pencil, Truck } from "lucide-react";
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
import { MoneyInput } from "@/components/money-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { amountToInput, formatMoney, parseArAmount } from "@/lib/format";

import type { TripRates } from "../account-schema";
import { useUpdateTripRates } from "../hooks/use-employee-account";

const toText = (n: number | null) => (n === null ? "" : amountToInput(n));

const FIELDS = [
  ["trip_rate_per_day", "Por jornada"],
  ["trip_rate_per_km", "Por km"],
  ["trip_rate_per_unload", "Por descarga"],
] as const;

type RateKey = (typeof FIELDS)[number][0];

/** A driver's rates for the planilla's trip extras (Extras desde viajes). */
export function TripRatesCard({
  employeeId,
  rates,
  canWrite,
}: {
  employeeId: string;
  rates: TripRates;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Truck className="size-4 text-muted-foreground" />
            Extras por viajes
          </h2>
          <p className="text-xs text-muted-foreground">
            La planilla sugiere los extras del mes con los viajes completados de
            su chofer y estas tarifas. Las cargas que ya paga el recibo no se
            cobran aparte.
          </p>
        </div>
        {canWrite && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Pencil className="size-4" />
            Editar
          </Button>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {FIELDS.map(([key, label]) => (
          <div key={key} className="flex items-center justify-between">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono">
              {rates[key] === null ? "—" : formatMoney(rates[key])}
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Cargas por recibo</dt>
          <dd className="font-mono">{rates.trip_unloads_in_receipt ?? "—"}</dd>
        </div>
      </dl>
      {canWrite && open && (
        <TripRatesDialog
          employeeId={employeeId}
          rates={rates}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}

function TripRatesDialog({
  employeeId,
  rates,
  open,
  onOpenChange,
}: {
  employeeId: string;
  rates: TripRates;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useUpdateTripRates();
  const [draft, setDraft] = useState<Record<RateKey, string>>({
    trip_rate_per_day: toText(rates.trip_rate_per_day),
    trip_rate_per_km: toText(rates.trip_rate_per_km),
    trip_rate_per_unload: toText(rates.trip_rate_per_unload),
  });
  const [inReceipt, setInReceipt] = useState(
    rates.trip_unloads_in_receipt === null
      ? ""
      : String(rates.trip_unloads_in_receipt),
  );
  const toValue = (v: string) =>
    v.trim() === "" ? null : (parseArAmount(v) ?? Number.NaN);

  function onSave() {
    mutation.mutate(
      {
        employee_id: employeeId,
        trip_rate_per_day: toValue(draft.trip_rate_per_day),
        trip_rate_per_km: toValue(draft.trip_rate_per_km),
        trip_rate_per_unload: toValue(draft.trip_rate_per_unload),
        trip_unloads_in_receipt:
          inReceipt.trim() === "" ? null : Number(inReceipt),
      },
      {
        onSuccess: () => {
          toast.success("Tarifas guardadas.");
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
          <DialogTitle>Tarifas de extras por viajes</DialogTitle>
          <DialogDescription>
            Jornada = día con al menos un viaje completado; descarga = carga
            entregada. Vacío = no se sugiere ese concepto.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {FIELDS.map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`rate-${key}`}>{label}</Label>
              <MoneyInput
                id={`rate-${key}`}
                className="text-right font-mono"
                value={draft[key]}
                onChange={(value) => setDraft((d) => ({ ...d, [key]: value }))}
              />
            </div>
          ))}
          <div className="space-y-2">
            <Label htmlFor="trip-unloads-in-receipt">Cargas por recibo</Label>
            <Input
              id="trip-unloads-in-receipt"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              className="text-right font-mono"
              value={inReceipt}
              onChange={(e) => setInReceipt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Las que ya paga el recibo: los extras del mes cobran solo las
              descargas que pasan esta cantidad. Vacío = ninguna.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={mutation.isPending}>
            {mutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
