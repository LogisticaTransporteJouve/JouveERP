"use client";

import { History } from "lucide-react";

import { formatMoney } from "@/lib/format";

import { useSalaryChanges } from "../hooks/use-employee-account";

function monthLabel(isoFirstDay: string): string {
  const [y, m] = isoFirstDay.split("-");
  return `${m}/${y}`;
}

/** Changes of the base salary: raises (with their %) and hand edits. */
export function SalaryHistoryCard({ employeeId }: { employeeId: string }) {
  const { data, isPending, isError, error } = useSalaryChanges(employeeId);
  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <History className="size-4 text-muted-foreground" />
        Historial de sueldo
      </h2>
      <div className="mt-3 text-sm">
        {isPending ? (
          <p className="text-muted-foreground">Cargando…</p>
        ) : isError ? (
          <p className="text-muted-foreground">
            No se pudo leer el historial: {error.message}
          </p>
        ) : data.length === 0 ? (
          <p className="text-muted-foreground">
            Sin cambios registrados desde que se lleva el historial.
          </p>
        ) : (
          <ul className="divide-y">
            {data.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <p className="font-medium">
                    Desde {monthLabel(c.effective_month)}
                    {c.raise_percentage !== null
                      ? ` · aumento ${c.raise_percentage}%`
                      : " · edición manual"}
                  </p>
                  {c.reason && (
                    <p className="text-xs text-muted-foreground">{c.reason}</p>
                  )}
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  {c.previous_salary === null
                    ? "—"
                    : formatMoney(c.previous_salary)}{" "}
                  →{" "}
                  <span className="text-foreground">
                    {c.new_salary === null ? "—" : formatMoney(c.new_salary)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
