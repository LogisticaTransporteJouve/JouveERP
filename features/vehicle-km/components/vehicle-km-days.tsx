"use client";

import Link from "next/link";
import { Suspense, useState } from "react";

import { PeriodFilter } from "@/components/period-filter";
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

function DaysTable({
  vehicleId,
  from,
  to,
  showDrivers,
  linkDrivers,
}: {
  vehicleId: string;
  from: string;
  to: string;
  showDrivers: boolean;
  linkDrivers: boolean;
}) {
  const { data } = useVehicleKmDays(vehicleId, from, to);
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Sin km de Strix ni viajes entre el {formatArgentineDate(from)} y el{" "}
        {formatArgentineDate(to)}.
      </p>
    );
  }
  const total = data.reduce((s, d) => s + (d.km ?? 0), 0);
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Día</TableHead>
            <TableHead className="text-right">Km</TableHead>
            {showDrivers && <TableHead>Chofer</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((d) => (
            <TableRow key={d.day}>
              <TableCell>{formatArgentineDate(d.day)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {d.km === null ? "—" : formatInteger(d.km)}
              </TableCell>
              {showDrivers && (
                <TableCell>
                  {d.drivers.length === 0 ? (
                    <span className="text-muted-foreground text-sm">
                      Sin viaje cargado
                    </span>
                  ) : (
                    <span className="flex flex-wrap gap-x-3">
                      {d.drivers.map((p) =>
                        linkDrivers ? (
                          <Link
                            key={p.id}
                            href={`/drivers/${p.id}`}
                            className="text-sm underline-offset-4 hover:underline"
                          >
                            {p.full_name}
                          </Link>
                        ) : (
                          <span key={p.id} className="text-sm">
                            {p.full_name}
                          </span>
                        ),
                      )}
                    </span>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatInteger(total)}
            </TableCell>
            {showDrivers && <TableCell />}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

/** A vehicle's km per day (Strix) and who drove it (trips), by range. */
export function VehicleKmDays({
  vehicleId,
  showDrivers,
  linkDrivers,
}: {
  vehicleId: string;
  showDrivers: boolean;
  linkDrivers: boolean;
}) {
  const [selection, setSelection] = useState<PeriodSelection>({
    preset: "this_month",
    from: null,
    to: null,
  });
  const range = kmPeriod(resolvePeriod(selection));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Km por día</h2>
          <p className="text-muted-foreground text-sm">
            Km según Strix (GPS)
            {showDrivers && "; el chofer sale de los viajes de ese día"}.
          </p>
        </div>
        <PeriodFilter value={selection} onChange={setSelection} />
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <DaysTable
          vehicleId={vehicleId}
          from={range.from}
          to={range.to}
          showDrivers={showDrivers}
          linkDrivers={linkDrivers}
        />
      </Suspense>
    </section>
  );
}
