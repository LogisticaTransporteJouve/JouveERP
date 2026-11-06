"use client";

import { useRouter } from "next/navigation";
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

import { useVehicleKmRange } from "../hooks/use-vehicle-km";
import { kmPeriod } from "../lib/km-period";
import type { VehicleKmRow } from "../schema";

import { StrixBar } from "./strix-bar";

function KmRangeTable({
  from,
  to,
  onOpen,
}: {
  from: string;
  to: string;
  onOpen: (row: VehicleKmRow) => void;
}) {
  const { data } = useVehicleKmRange(from, to);
  if (data.rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No hay vehículos activos que lleven km.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vehículo</TableHead>
            <TableHead className="text-right">Km recorridos</TableHead>
            <TableHead className="text-right">Días con km</TableHead>
            <TableHead className="text-right">Último día</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row) => (
            <TableRow
              key={row.vehicle_id}
              className="cursor-pointer"
              onClick={() => onOpen(row)}
            >
              <TableCell>
                <button
                  type="button"
                  className="font-mono text-xs underline-offset-4 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(row);
                  }}
                >
                  {row.patente}
                </button>
                {row.alias && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    {row.alias}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatInteger(row.km)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.days}
              </TableCell>
              <TableCell className="text-right text-sm">
                {row.last_day ? formatArgentineDate(row.last_day) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatInteger(data.total)}
            </TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

export function VehicleKmView({
  canWrite,
  canAdmin,
}: {
  canWrite: boolean;
  canAdmin: boolean;
}) {
  const [selection, setSelection] = useState<PeriodSelection>({
    preset: "this_month",
    from: null,
    to: null,
  });
  const range = kmPeriod(resolvePeriod(selection));
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Km recorridos
          </h1>
          <p className="text-muted-foreground text-sm">
            Los km de cada vehículo según Strix (GPS), por día. Se traen solos
            todos los días; hacé clic en una patente para ver cada día y quién
            manejó.
          </p>
        </div>
        <PeriodFilter value={selection} onChange={setSelection} />
      </div>
      <StrixBar
        from={range.from}
        to={range.to}
        canWrite={canWrite}
        canAdmin={canAdmin}
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <KmRangeTable
          from={range.from}
          to={range.to}
          onOpen={(row) => router.push(`/vehicles/${row.vehicle_id}`)}
        />
      </Suspense>
    </div>
  );
}
