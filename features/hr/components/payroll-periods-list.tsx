"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { usePayrollPeriods } from "../hooks/use-payroll";
import {
  PAYROLL_STATUS_LABEL,
  formatPayrollPeriod,
  payrollPeriodHref,
  type PayrollPeriod,
} from "../payroll-schema";

import { NewPayrollPeriodDialog } from "./new-payroll-period-dialog";
import { NewSacPeriodDialog } from "./new-sac-period-dialog";

export function PayrollPeriodsList({ actorAccess }: { actorAccess: Access }) {
  const { data: periods } = usePayrollPeriods();
  const canWrite = userCan(actorAccess, "hr:write");

  const columns = useMemo<ColumnDef<PayrollPeriod>[]>(
    () => [
      {
        id: "period",
        header: "Período",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            href={payrollPeriodHref(
              row.original.year,
              row.original.month,
              row.original.kind,
            )}
            className="hover:underline"
          >
            {formatPayrollPeriod(
              row.original.year,
              row.original.month,
              row.original.kind,
            )}
          </Link>
        ),
        meta: { cellClassName: "font-medium" },
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ row }) => (
          <Badge
            variant={row.original.status === "closed" ? "secondary" : "outline"}
            className={
              row.original.status === "closed"
                ? "bg-muted text-muted-foreground dark:text-muted-foreground"
                : ""
            }
          >
            {PAYROLL_STATUS_LABEL[row.original.status]}
          </Badge>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Creado",
        cell: ({ row }) =>
          row.original.created_at
            ? formatArgentineDate(row.original.created_at)
            : "—",
        meta: { cellClassName: "text-sm text-muted-foreground" },
      },
      {
        accessorKey: "closed_at",
        header: "Cerrado",
        cell: ({ row }) =>
          row.original.closed_at
            ? formatArgentineDate(row.original.closed_at)
            : "—",
        meta: { cellClassName: "text-sm text-muted-foreground" },
      },
      {
        id: "actions",
        header: "Acciones",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) => (
          <Link
            href={payrollPeriodHref(
              row.original.year,
              row.original.month,
              row.original.kind,
            )}
            className="text-sm text-primary hover:underline"
          >
            Abrir →
          </Link>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sueldos</h1>
          <p className="text-sm text-muted-foreground">
            Una planilla editable por mes, y una por semestre para el SAC.
          </p>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <NewSacPeriodDialog />
            <NewPayrollPeriodDialog />
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        data={periods}
        getRowId={(p) => p.id}
        emptyMessage="No hay períodos generados todavía."
      />
    </div>
  );
}
