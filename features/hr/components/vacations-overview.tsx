"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate } from "@/lib/format";

import { useVacationOverview } from "../hooks/use-vacations";

import { VacationOpeningDialog } from "./vacation-opening-dialog";

/** Personal → Vacaciones: every active employee's days for the period in
 *  course and from earlier years. */
export function VacationsOverview({
  canSetVacations,
}: {
  /** Owner/admin: may load the days by hand. */
  canSetVacations: boolean;
}) {
  const { data, isLoading, isError } = useVacationOverview();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((r) => r.legal_name.toLowerCase().includes(q)) : all;
  }, [data, query]);

  const period = data?.period_year;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Vacaciones</h1>
          <p className="text-sm text-muted-foreground">
            {period
              ? `Período ${period}-${period + 1}: se toma del 1/10/${period} al 30/4/${period + 1}. Los días de años anteriores se usan primero.`
              : "Saldos de vacaciones de cada empleado."}
          </p>
        </div>
        <Input
          className="w-full sm:w-64"
          placeholder="Buscar empleado"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          No se pudieron cargar las vacaciones.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query ? "Ningún empleado coincide." : "No hay empleados activos."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empleado</TableHead>
                <TableHead>Ingreso</TableHead>
                <TableHead className="text-right">Período en curso</TableHead>
                <TableHead className="text-right">Arrastre</TableHead>
                <TableHead className="text-right">Años anteriores</TableHead>
                <TableHead className="text-right">Tomados</TableHead>
                <TableHead className="text-right">Disponibles</TableHead>
                <TableHead>Vence</TableHead>
                {canSetVacations && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employee_id}>
                  <TableCell>
                    <Link
                      href={`/employees/${r.employee_id}`}
                      className="font-medium hover:underline"
                    >
                      {r.legal_name}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatArgentineDate(r.hire_date)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.current_days ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.carryover_days}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.previous_days}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.used_days}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {r.remaining_days}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.expires_at ? formatArgentineDate(r.expires_at) : "—"}
                  </TableCell>
                  {canSetVacations && (
                    <TableCell className="text-right">
                      <VacationOpeningDialog
                        employeeId={r.employee_id}
                        employeeName={r.legal_name}
                        hireDate={r.hire_date}
                        currentDays={r.current_days}
                        previousDays={r.previous_days}
                        triggerLabel="Cargar"
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        “Período en curso” vacío: todavía no se otorgó (se hace solo el 1/10) o
        hay que cargarlo a mano. Las vacaciones se registran como licencia desde
        la ficha del empleado.
      </p>
    </div>
  );
}
