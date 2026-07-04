"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { usePayrollPeriods } from "../hooks/use-payroll";
import {
  PAYROLL_STATUS_LABEL,
  formatPayrollPeriod,
  type PayrollPeriod,
} from "../payroll-schema";

import { NewPayrollPeriodDialog } from "./new-payroll-period-dialog";

export function PayrollPeriodsList({ actorRoles }: { actorRoles: Role[] }) {
  const { data: periods } = usePayrollPeriods();
  const canWrite = userCan(actorRoles, "hr:write");

  const columns = useMemo<ColumnDef<PayrollPeriod>[]>(
    () => [
      {
        id: "period",
        header: "Período",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            href={`/hr/payroll/${row.original.year}/${row.original.month}`}
            className="hover:underline"
          >
            {formatPayrollPeriod(row.original.year, row.original.month)}
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
            href={`/hr/payroll/${row.original.year}/${row.original.month}`}
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
            Períodos mensuales. Una fila por mes con planilla editable.
          </p>
        </div>
        {canWrite && <NewPayrollPeriodDialog />}
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
