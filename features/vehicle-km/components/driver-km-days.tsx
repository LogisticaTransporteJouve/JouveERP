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

import { useDriverKmDays } from "../hooks/use-vehicle-km";
import { kmPeriod } from "../lib/km-period";

const LINK = "underline-offset-4 hover:underline";

function TripsTable({
  driverId,
  from,
  to,
  linkVehicles,
}: {
  driverId: string;
  from: string;
  to: string;
  linkVehicles: boolean;
}) {
  const { data } = useDriverKmDays(driverId, from, to);
  if (data.trips.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Sin viajes entre el {formatArgentineDate(from)} y el{" "}
        {formatArgentineDate(to)}.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Día</TableHead>
            <TableHead>Vehículo</TableHead>
            <TableHead>Viaje</TableHead>
            <TableHead className="text-right">Km del vehículo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.trips.map((t) => (
            <TableRow key={t.trip_id}>
              <TableCell>{formatArgentineDate(t.day)}</TableCell>
              <TableCell>
                {!t.vehicle ? (
                  "—"
                ) : linkVehicles ? (
                  <Link
                    href={`/vehicles/${t.vehicle.id}`}
                    className={`font-mono text-xs ${LINK}`}
                  >
                    {t.vehicle.patente}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">{t.vehicle.patente}</span>
                )}
              </TableCell>
              <TableCell>
                <Link
                  href={`/trips/${t.trip_id}`}
                  className={`text-sm ${LINK}`}
                >
                  {t.route ?? "Ver viaje"}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {t.km === null ? "—" : formatInteger(t.km)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3}>Total</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatInteger(data.total)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

/** A driver's trips by range, each with its vehicle's km that day. */
export function DriverKmDays({
  driverId,
  linkVehicles,
}: {
  driverId: string;
  linkVehicles: boolean;
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
          <h2 className="text-lg font-semibold">Viajes y km</h2>
          <p className="text-muted-foreground text-sm">
            Los km son los que hizo el vehículo ese día según Strix; si dos
            viajes comparten vehículo y día, el total los cuenta una vez.
          </p>
        </div>
        <PeriodFilter value={selection} onChange={setSelection} />
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <TripsTable
          driverId={driverId}
          from={range.from}
          to={range.to}
          linkVehicles={linkVehicles}
        />
      </Suspense>
    </section>
  );
}
