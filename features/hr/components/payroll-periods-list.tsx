"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { usePayrollPeriods } from "../hooks/use-payroll";
import {
  PAYROLL_STATUS_LABEL,
  formatPayrollPeriod,
} from "../payroll-schema";

import { NewPayrollPeriodDialog } from "./new-payroll-period-dialog";

export function PayrollPeriodsList({ actorRoles }: { actorRoles: Role[] }) {
  const { data: periods } = usePayrollPeriods();
  const canWrite = userCan(actorRoles, "hr:write");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sueldos</h1>
          <p className="text-sm text-muted-foreground">
            Períodos mensuales. Una fila por mes con planilla editable.
          </p>
        </div>
        {canWrite && <NewPayrollPeriodDialog />}
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead>Cerrado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No hay períodos generados todavía.
                </TableCell>
              </TableRow>
            ) : (
              periods.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/hr/payroll/${p.year}/${p.month}`}
                      className="hover:underline"
                    >
                      {formatPayrollPeriod(p.year, p.month)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={p.status === "closed" ? "secondary" : "outline"}
                      className={
                        p.status === "closed"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : ""
                      }
                    >
                      {PAYROLL_STATUS_LABEL[p.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.created_at ? formatArgentineDate(p.created_at) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.closed_at ? formatArgentineDate(p.closed_at) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/hr/payroll/${p.year}/${p.month}`}
                      className="text-sm text-primary hover:underline"
                    >
                      Abrir →
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
