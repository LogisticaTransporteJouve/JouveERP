"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MoneyInput } from "@/components/money-input";
import {
  amountToInput,
  formatArgentineDate,
  formatMoney,
  formatNumber2,
  parseArAmount,
} from "@/lib/format";

import type { EntryTripExtras } from "../actions/trip-extras-actions";
import type { TripExtraLine } from "../account-schema";
import { usePeriodTripExtras } from "../hooks/use-employee-account";
import { useAddPayrollEntryExtra } from "../hooks/use-payroll";
import { accountKeys } from "../lib/account-keys";

/**
 * "Extras de viajes": the month's suggested driver extras from completed
 * trips (jornadas, km, descargas × the employee's rates). Each line is added
 * as an ordinary extra; the amount can be changed before adding it.
 */
export function TripExtrasDialog({
  year,
  month,
}: {
  year: number;
  month: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Truck className="size-4" />
          Extras de viajes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Extras de viajes</DialogTitle>
          <DialogDescription>
            Sugeridos con los viajes completados del mes de cada chofer y las
            tarifas de su ficha (jornada, km, descarga). Revisá el importe y
            agregalo como extra; después se edita como cualquier otro.
          </DialogDescription>
        </DialogHeader>
        {open && <TripExtrasBody year={year} month={month} />}
      </DialogContent>
    </Dialog>
  );
}

function TripExtrasBody({ year, month }: { year: number; month: number }) {
  const { data, isPending, isError, error } = usePeriodTripExtras(
    year,
    month,
    true,
  );
  if (isPending) {
    return <p className="text-sm text-muted-foreground">Cargando viajes…</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        No se pudieron leer los viajes: {error.message}
      </p>
    );
  }
  if (data.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ningún empleado de la planilla tiene viajes completados este mes (el
        empleado tiene que estar vinculado a un chofer).
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {data.partial && (
        <p className="text-xs text-muted-foreground">
          El mes tiene más de 2000 viajes: la sugerencia es parcial.
        </p>
      )}
      {data.rows.map((row) => (
        <EmployeeTrips key={row.entry_id} row={row} year={year} month={month} />
      ))}
    </div>
  );
}

function EmployeeTrips({
  row,
  year,
  month,
}: {
  row: EntryTripExtras;
  year: number;
  month: number;
}) {
  const [showTrips, setShowTrips] = useState(false);
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{row.employee_name}</p>
        <p className="text-xs text-muted-foreground">
          {row.trips.length} viajes · {row.days} jornadas ·{" "}
          {formatNumber2(row.km)} km · {row.unloads} descargas
          {row.unloads_in_receipt > 0
            ? ` (${row.unloads_in_receipt} por recibo)`
            : ""}
        </p>
      </div>
      {row.lines.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Sin tarifas cargadas en la ficha del empleado.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {row.lines.map((line) => (
            <SuggestedLine
              key={line.concept}
              line={line}
              entryId={row.entry_id}
              added={row.added.includes(line.concept)}
              year={year}
              month={month}
            />
          ))}
        </ul>
      )}
      <Button
        variant="link"
        size="sm"
        className="h-auto px-0 text-xs"
        onClick={() => setShowTrips((v) => !v)}
      >
        {showTrips ? "Ocultar viajes" : "Ver viajes"}
      </Button>
      {showTrips && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {row.trips.map((t) => (
            <li key={t.id}>
              {formatArgentineDate(t.trip_date)} · {t.origin ?? "—"} →{" "}
              {t.destination ?? "—"} · {t.km === null ? "sin km" : `${t.km} km`}
              {t.unloads > 0 ? ` · ${t.unloads} descargas` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestedLine({
  line,
  entryId,
  added,
  year,
  month,
}: {
  line: TripExtraLine;
  entryId: string;
  added: boolean;
  year: number;
  month: number;
}) {
  const qc = useQueryClient();
  const addMut = useAddPayrollEntryExtra();
  const [amount, setAmount] = useState(amountToInput(line.amount));

  function onAdd() {
    const value = parseArAmount(amount);
    if (value === null || value <= 0) {
      toast.error("Importe inválido.");
      return;
    }
    addMut.mutate(
      {
        entry_id: entryId,
        amount: value,
        description: line.description,
        period_year: year,
        period_month: month,
      },
      {
        onSuccess: () => {
          toast.success("Extra agregado.");
          qc.invalidateQueries({
            queryKey: accountKeys.tripExtras(year, month),
          });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0">
        {line.description}
        <span className="ml-1 text-xs text-muted-foreground">
          ({formatNumber2(line.quantity)} × {formatMoney(line.rate)})
        </span>
      </span>
      {added ? (
        <Badge variant="outline" className="text-[10px] font-normal">
          Ya agregado
        </Badge>
      ) : (
        <span className="flex items-center gap-1">
          <MoneyInput
            aria-label={`Importe de ${line.description}`}
            className="h-8 w-32 text-right font-mono"
            value={amount}
            onChange={setAmount}
          />
          <Button size="sm" onClick={onAdd} disabled={addMut.isPending}>
            Agregar
          </Button>
        </span>
      )}
    </li>
  );
}
