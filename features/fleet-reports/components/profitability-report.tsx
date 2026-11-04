"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { todayInAR } from "@/lib/format";

import { useFleetProfitability } from "../hooks/use-fleet-reports";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

/** A net with cargas still to invoice is not final: not shown as a loss. */
function NetCell({ net, pending }: { net: number; pending: boolean }) {
  return (
    <TableCell
      className={cn(
        "text-right font-mono tabular-nums",
        net < 0 && !pending && "text-destructive",
      )}
    >
      {money(net)}
      {pending && (
        <span className="text-muted-foreground block font-sans text-xs">
          pendiente de facturar
        </span>
      )}
    </TableCell>
  );
}

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function ProfitabilityReport() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    setStart(monthStart());
    setEnd(todayInAR());
  }, []);

  const { data, isLoading } = useFleetProfitability(start, end);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Rentabilidad de flota
        </h1>
        <p className="text-muted-foreground text-sm">
          Ingresos menos costos (viaje, combustible, mantenimiento) por vehículo
          y por viaje en el rango. El ingreso de un viaje con cargas es el flete
          facturado de esas cargas; sin cargas, el ingreso cargado a mano en el
          viaje. Los totales incluyen los viajes sin vehículo.
        </p>
      </div>

      <div className="bg-card flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div className="space-y-1">
          <label className="text-muted-foreground text-xs">Desde</label>
          <Input
            type="date"
            value={start}
            max={end}
            onChange={(e) => setStart(e.target.value)}
            className="w-[170px]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground text-xs">Hasta</label>
          <Input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
            className="w-[170px]"
          />
        </div>
        {data && (
          <div className="text-muted-foreground ml-auto space-y-0.5 text-right text-sm">
            <div>
              Facturado:{" "}
              <span className="text-foreground font-mono">
                {money(data.totals.invoiced_revenue)}
              </span>{" "}
              · Manual:{" "}
              <span className="text-foreground font-mono">
                {money(data.totals.manual_revenue)}
              </span>
            </div>
            <div>
              Neto del rango:{" "}
              <span
                className={cn(
                  "font-mono font-semibold",
                  data.totals.net < 0 &&
                    data.totals.pending_invoicing_trips === 0
                    ? "text-destructive"
                    : "text-foreground",
                )}
              >
                {money(data.totals.net)}
              </span>
            </div>
            {data.totals.pending_invoicing_trips > 0 && (
              <div className="text-xs">
                {data.totals.pending_invoicing_trips} viaje(s) con{" "}
                {data.totals.uninvoiced_shipments} carga(s) sin facturar
                {data.totals.uninvoiced_freight > 0
                  ? ` (flete ${money(data.totals.uninvoiced_freight)})`
                  : ""}
                : no están en los ingresos, así que el neto no es definitivo.
              </div>
            )}
          </div>
        )}
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Por vehículo</h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehículo</TableHead>
                    <TableHead className="w-16 text-right">Viajes</TableHead>
                    <TableHead className="text-right">Ingresos</TableHead>
                    <TableHead className="text-right">Facturado</TableHead>
                    <TableHead className="text-right">Manual</TableHead>
                    <TableHead className="text-right">Combustible</TableHead>
                    <TableHead className="text-right">Mant.</TableHead>
                    <TableHead className="text-right">Costo viaje</TableHead>
                    <TableHead className="text-right">Neto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.vehicles.length === 0 && !data.without_vehicle ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="text-muted-foreground py-8 text-center text-sm"
                      >
                        Sin movimientos en el rango.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.vehicles.map((v) => (
                      <TableRow key={v.vehicle_id}>
                        <TableCell className="font-mono text-xs">
                          {v.patente}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {v.trips}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {money(v.revenue)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right font-mono tabular-nums">
                          {money(v.invoiced_revenue)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right font-mono tabular-nums">
                          {money(v.manual_revenue)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {money(v.fuel_cost)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {money(v.maintenance_cost)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {money(v.trip_cost)}
                        </TableCell>
                        <NetCell
                          net={v.net}
                          pending={v.uninvoiced_shipments > 0}
                        />
                      </TableRow>
                    ))
                  )}
                  {data.without_vehicle && (
                    <TableRow className="text-muted-foreground">
                      <TableCell className="text-xs">Sin vehículo</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {data.without_vehicle.trips}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {money(data.without_vehicle.revenue)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {money(data.without_vehicle.invoiced_revenue)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {money(data.without_vehicle.manual_revenue)}
                      </TableCell>
                      <TableCell colSpan={2} />
                      <TableCell className="text-right font-mono tabular-nums">
                        {money(data.without_vehicle.trip_cost)}
                      </TableCell>
                      <NetCell
                        net={data.without_vehicle.net}
                        pending={data.without_vehicle.uninvoiced_shipments > 0}
                      />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {data.totals.maintenance_without_cost > 0 && (
              <p className="text-muted-foreground text-xs">
                {data.totals.maintenance_without_cost} mantenimiento(s) sin
                costo cargado: no están en «Mant.» ni en el neto.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Costos sin comprobante</h2>
            <p className="text-muted-foreground text-sm">
              Cargas de combustible y mantenimientos del rango sin factura de
              compra ni movimiento vinculado: no llegan a la contabilidad.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="bg-card rounded-lg border p-4">
                <p className="text-muted-foreground text-xs">Combustible</p>
                <p className="font-mono text-lg font-semibold tabular-nums">
                  {money(data.unvouchered.fuel_amount)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {data.unvouchered.fuel_count} cargas
                </p>
              </div>
              <div className="bg-card rounded-lg border p-4">
                <p className="text-muted-foreground text-xs">Mantenimiento</p>
                <p className="font-mono text-lg font-semibold tabular-nums">
                  {money(data.unvouchered.maintenance_cost)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {data.unvouchered.maintenance_count} registros
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Por viaje</h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Fecha</TableHead>
                    <TableHead>Vehículo</TableHead>
                    <TableHead>Ruta</TableHead>
                    <TableHead className="text-right">Ingreso</TableHead>
                    <TableHead className="text-right">Facturado</TableHead>
                    <TableHead className="text-right">Manual</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Comb.</TableHead>
                    <TableHead className="text-right">Neto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.trips.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="text-muted-foreground py-8 text-center text-sm"
                      >
                        Sin viajes en el rango.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.trips.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="tabular-nums">
                          {t.trip_date}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {t.patente ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {[t.origin, t.destination]
                            .filter(Boolean)
                            .join(" → ") || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          <div className="flex items-center justify-end gap-2">
                            <Badge variant="outline" className="font-sans">
                              {t.revenue_source === "invoiced"
                                ? "Facturado"
                                : "Manual"}
                            </Badge>
                            {money(t.revenue)}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right font-mono tabular-nums">
                          {money(t.invoiced_revenue)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right font-mono tabular-nums">
                          {money(t.manual_revenue)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {money(t.trip_cost)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {money(t.fuel_cost)}
                        </TableCell>
                        <NetCell
                          net={t.net}
                          pending={t.uninvoiced_shipments > 0}
                        />
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
