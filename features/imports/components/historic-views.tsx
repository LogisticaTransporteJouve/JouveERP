"use client";

import { Suspense, useState } from "react";

import { MonthPicker } from "@/components/ui/month-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatArgentineDate,
  formatMoney,
  formatNumber2,
  formatPeriod,
} from "@/lib/format";

import { useHistoricPayroll, useHistoricTrips } from "../hooks/use-imports";
import { HISTORIC_PAYROLL_KIND_LABELS } from "../schema";

// Historic payroll and trips (roadmap 5.2): reference only. They are read
// here and nowhere else, so no balance, report or fiscal book includes them.

function HistoricPayrollTable({ year }: { year: number }) {
  const { data } = useHistoricPayroll(year);
  if (data.entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No hay sueldos históricos de {year}.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Empleados</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className="text-right">Pagado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.totals.map((t) => (
              <TableRow key={t.period}>
                <TableCell className="text-sm">
                  {formatPeriod(t.period)}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {t.entries}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {formatMoney(t.net)}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {t.paid === null ? "—" : formatMoney(t.paid)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead>
              <TableHead>Empleado</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className="text-right">Pagado</TableHead>
              <TableHead>Pagado el</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-sm whitespace-nowrap">
                  {formatPeriod(e.period)}
                </TableCell>
                <TableCell className="text-sm">
                  {e.employee_name}
                  {e.notes && (
                    <span className="text-muted-foreground block text-xs">
                      {e.notes}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {HISTORIC_PAYROLL_KIND_LABELS[e.kind]}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {formatMoney(e.net_amount)}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {e.paid_amount === null ? "—" : formatMoney(e.paid_amount)}
                </TableCell>
                <TableCell className="text-sm">
                  {formatArgentineDate(e.paid_on)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function HistoricPayrollView({ currentYear }: { currentYear: number }) {
  const [year, setYear] = useState(currentYear);
  const years = Array.from({ length: 16 }, (_, i) => currentYear - i);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Sueldos de antes del sistema, importados de planillas. Son solo de
          referencia: no generan asientos, pagos ni cuenta corriente, y no
          entran en las planillas, Gestión ni los libros.
        </p>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-32" aria-label="Año">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <HistoricPayrollTable year={year} />
      </Suspense>
    </div>
  );
}

function HistoricTripsTable({ month }: { month: string }) {
  const { data } = useHistoricTrips(month);
  if (data.trips.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No hay viajes históricos de {formatPeriod(month)}.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        {data.totals.trips} viajes · {formatNumber2(data.totals.km)} km · flete{" "}
        {formatMoney(data.totals.freight)}
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Vehículo</TableHead>
              <TableHead>Chofer</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Recorrido</TableHead>
              <TableHead className="text-right">Km</TableHead>
              <TableHead className="text-right">Flete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.trips.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-sm whitespace-nowrap">
                  {formatArgentineDate(t.trip_date)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {t.vehicle ?? "—"}
                </TableCell>
                <TableCell className="text-sm">{t.driver ?? "—"}</TableCell>
                <TableCell className="text-sm">{t.client ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  {t.origin ?? "—"} → {t.destination ?? "—"}
                  {t.notes && (
                    <span className="text-muted-foreground block text-xs">
                      {t.notes}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {t.km === null ? "—" : formatNumber2(t.km)}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {t.freight_amount === null
                    ? "—"
                    : formatMoney(t.freight_amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function HistoricTripsView({ currentMonth }: { currentMonth: string }) {
  const [month, setMonth] = useState(currentMonth);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Viajes de antes del sistema, importados de planillas. Son solo de
          referencia: no generan facturas, extras de chofer ni entran en Gestión
          ni en los libros.
        </p>
        <MonthPicker
          aria-label="Mes"
          className="w-44"
          value={month}
          max={currentMonth}
          onChange={(value) => {
            if (/^\d{4}-\d{2}$/.test(value)) setMonth(value);
          }}
        />
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <HistoricTripsTable month={month} />
      </Suspense>
    </div>
  );
}
