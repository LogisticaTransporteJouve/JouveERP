"use client";

import { Info } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber2 } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useVehicleMargin } from "../hooks/use-management";
import { money } from "../lib/format";
import type { ManagementBasis, VehicleMarginRow } from "../schema";

function pct(value: number | null): string {
  return value === null ? "—" : `${formatNumber2(value)} %`;
}

/** Margin per truck of the fiscal year: always accrual and nominal. */
export function VehicleMarginSection({
  fromPeriod,
  toPeriod,
  basis,
  inflation,
  centerLabel,
}: {
  fromPeriod: string;
  toPeriod: string;
  basis: ManagementBasis;
  inflation: boolean;
  centerLabel: (id: string | null) => string;
}) {
  const query = useVehicleMargin({ fromPeriod, toPeriod });
  const differs = basis !== "accrual" || inflation;

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Margen por camión</h2>
        <p className="text-xs text-muted-foreground">
          Año fiscal completo, devengado y sin ajuste por inflación
          {differs ? " (no sigue la base elegida arriba)" : ""}. Ingreso y
          costos de sus viajes (sin cancelados), combustible y mantenimiento,
          más lo cargado con el centro de costo del camión (se vincula en{" "}
          <Link href="/accounting/cost-centers" className="underline">
            Centros de costo
          </Link>
          ). Lo que no es de un camión va aparte: no se reparte.
        </p>
      </div>
      {query.isPending ? (
        <Skeleton className="m-4 h-32" />
      ) : query.isError ? (
        <p className="px-4 py-3 text-sm">
          No se pudo calcular el margen por camión: {query.error.message}
        </p>
      ) : (
        <VehicleMarginTable
          vehicles={query.data.vehicles}
          withoutVehicle={query.data.withoutVehicle}
          unattributed={query.data.unattributed}
          partial={query.data.partial}
          centerLabel={centerLabel}
        />
      )}
    </div>
  );
}

function VehicleMarginTable({
  vehicles,
  withoutVehicle,
  unattributed,
  partial,
  centerLabel,
}: {
  vehicles: VehicleMarginRow[];
  withoutVehicle: VehicleMarginRow | null;
  unattributed: VehicleMarginRow[];
  partial: boolean;
  centerLabel: (id: string | null) => string;
}) {
  const pendingUsd = [...vehicles, ...unattributed].reduce(
    (s, r) => s + r.pendingUsd,
    0,
  );
  const withoutCenter = vehicles.filter((v) => v.costCenterId === null).length;
  const withoutCost = vehicles.reduce(
    (s, v) => s + v.maintenanceWithoutCost,
    0,
  );

  if (vehicles.length === 0 && !withoutVehicle && unattributed.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        Sin movimientos en el año.
      </p>
    );
  }

  return (
    <div className="space-y-3 pb-3">
      {partial && (
        <p className="flex gap-2 px-4 pt-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" />
          La lectura llegó a su tope: puede faltar una parte.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-xs">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Camión</th>
              <th className="px-3 py-2 text-right">Viajes</th>
              <th className="px-3 py-2 text-right">Ingreso</th>
              <th className="px-3 py-2 text-right">Costo de viajes</th>
              <th className="px-3 py-2 text-right">Combustible</th>
              <th className="px-3 py-2 text-right">Mantenimiento</th>
              <th className="px-3 py-2 text-right">Centro de costo</th>
              <th className="px-3 py-2 text-right">Neto</th>
              <th className="px-3 py-2 text-right">Margen</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.vehicleId} className="border-t">
                <td className="px-3 py-1.5">
                  <span className="font-mono">{v.patente}</span>
                  {v.isActive === false && (
                    <span className="ml-1 text-muted-foreground">
                      (inactivo)
                    </span>
                  )}
                  <span className="block text-muted-foreground">
                    {v.costCenterId === null
                      ? "Sin centro vinculado"
                      : centerLabel(v.costCenterId)}
                  </span>
                </td>
                <Num value={v.trips} plain />
                <Num value={v.revenue} />
                <Num value={v.tripCost} />
                <Num value={v.fuelCost} />
                <Num value={v.maintenanceCost} />
                <Num value={v.centerCost} />
                <Num value={v.net} strong />
                <td className="px-3 py-1.5 text-right font-mono">
                  {pct(v.marginPct)}
                </td>
              </tr>
            ))}
            {withoutVehicle && (
              <tr className="border-t text-muted-foreground">
                <td className="px-3 py-1.5">Viajes sin vehículo</td>
                <Num value={withoutVehicle.trips} plain />
                <Num value={withoutVehicle.revenue} />
                <Num value={withoutVehicle.tripCost} />
                <td colSpan={3} />
                <Num value={withoutVehicle.net} strong />
                <td className="px-3 py-1.5 text-right font-mono">
                  {pct(withoutVehicle.marginPct)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {unattributed.length > 0 && (
        <div className="px-4">
          <p className="text-xs font-medium">
            Costos operativos sin camión (no se reparten)
          </p>
          <ul className="mt-1 divide-y text-xs">
            {unattributed.map((u) => (
              <li
                key={u.costCenterId ?? "none"}
                className="flex flex-wrap justify-between gap-2 py-1"
              >
                <span>{centerLabel(u.costCenterId)}</span>
                <span className="font-mono">{money(u.centerCost)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="list-disc space-y-0.5 px-4 pl-8 text-xs text-muted-foreground">
        {withoutCenter > 0 && (
          <li>
            {withoutCenter === 1
              ? "1 camión no tiene centro de costo vinculado"
              : `${withoutCenter} camiones no tienen centro de costo vinculado`}
            : sus seguros, patentes y compras cargadas con centro no se le
            suman.
          </li>
        )}
        {withoutCost > 0 && (
          <li>
            {withoutCost === 1
              ? "1 mantenimiento no tiene costo cargado"
              : `${withoutCost} mantenimientos no tienen costo cargado`}
            : no están en «Mantenimiento» ni en el neto.
          </li>
        )}
        <li>
          Una compra o un movimiento ya vinculado a una carga de combustible o a
          un mantenimiento cuenta una sola vez, por la carga o el service.
        </li>
        {pendingUsd !== 0 && (
          <li>
            Hay movimientos en dólares sin pasar a pesos, sin cotización o sin
            asiento (neto US$ {formatNumber2(pendingUsd)}), que no están
            sumados.
          </li>
        )}
      </ul>
    </div>
  );
}

function Num({
  value,
  plain,
  strong,
}: {
  value: number;
  plain?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-3 py-1.5 text-right font-mono",
        strong && "font-semibold",
      )}
    >
      {plain ? value : money(value)}
    </td>
  );
}
