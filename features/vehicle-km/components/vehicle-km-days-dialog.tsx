"use client";

import { useState } from "react";

import { PeriodFilter } from "@/components/period-filter";
import { ReadError } from "@/components/read-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate, formatInteger } from "@/lib/format";
import { resolvePeriod, type PeriodSelection } from "@/lib/list-period";

import { useVehicleKmDays } from "../hooks/use-vehicle-km";
import { kmPeriod } from "../lib/km-period";

/** A vehicle's km per day (Strix) for a range picked in the dialog. */
export function VehicleKmDaysDialog({
  vehicle,
  initial,
  onOpenChange,
}: {
  vehicle: { id: string; patente: string } | null;
  initial?: PeriodSelection;
  onOpenChange: (open: boolean) => void;
}) {
  const [selection, setSelection] = useState<PeriodSelection>(
    initial ?? { preset: "this_month", from: null, to: null },
  );
  const range = kmPeriod(resolvePeriod(selection));
  const days = useVehicleKmDays(vehicle?.id ?? null, range.from, range.to);
  const total = (days.data ?? []).reduce((s, d) => s + d.km, 0);

  return (
    <Dialog open={vehicle !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Km de {vehicle?.patente}</DialogTitle>
          <DialogDescription>
            Km recorridos por día, según Strix.
          </DialogDescription>
        </DialogHeader>
        <PeriodFilter value={selection} onChange={setSelection} />
        {days.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : days.isError ? (
          <ReadError
            message={days.error.message}
            onRetry={() => void days.refetch()}
          />
        ) : days.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Sin km de Strix entre el {formatArgentineDate(range.from)} y el{" "}
            {formatArgentineDate(range.to)}.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Día</TableHead>
                  <TableHead className="text-right">Km</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.data.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell>{formatArgentineDate(d.day)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatInteger(d.km)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatInteger(total)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
