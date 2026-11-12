"use client";

import { Ban, MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import { formatArgentineDate, formatMoney } from "@/lib/format";

import { useCancelLoan, useLoans } from "../hooks/use-loans";
import {
  canCancelLoan,
  LOAN_KIND_LABEL,
  LOAN_STATUS_LABEL,
  type LoanListItem,
} from "../schema";

import { LoanDialog } from "./loan-dialog";

export function LoansTable({
  canWrite,
}: {
  /** `accounting:write`: create and cancel loans. */
  canWrite: boolean;
}) {
  const { data: loans } = useLoans();
  const cancelMut = useCancelLoan();
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);

  const columns = useMemo<ColumnDef<LoanListItem>[]>(() => {
    async function handleCancel(loan: LoanListItem) {
      const ok = await confirm({
        title: `Anular ${loan.description}`,
        description:
          "Para un préstamo cargado por error: queda anulado y deja de proyectarse en el flujo de caja. No se puede si ya tiene el desembolso registrado o alguna cuota pagada.",
        confirmLabel: "Anular",
        tone: "destructive",
      });
      if (!ok) return;
      cancelMut.mutate(loan.id, {
        onSuccess: () => toast.success("Préstamo anulado."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "description",
        header: "Descripción",
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <div>
            <Link
              href={`/loans/${row.original.id}`}
              className="font-medium hover:underline"
            >
              {row.original.description}
            </Link>
            <Badge variant="outline" className="ml-2 text-[10px] font-normal">
              {LOAN_KIND_LABEL[row.original.kind]}
            </Badge>
            {row.original.loan_number && (
              <span className="text-muted-foreground block text-xs">
                Préstamo {row.original.loan_number}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "lender",
        header: "Banco",
        enableSorting: false,
        cell: ({ row }) => row.original.lender ?? "—",
        meta: { cellClassName: "text-sm", mobile: "secondary" },
      },
      {
        accessorKey: "principal",
        header: "Capital",
        meta: { align: "right", mobile: "secondary" },
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatMoney(row.original.principal, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "capital_outstanding",
        header: "Capital adeudado",
        meta: { align: "right", mobile: "secondary" },
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatMoney(
              row.original.capital_outstanding,
              row.original.currency,
            )}
          </span>
        ),
      },
      {
        id: "paid_count",
        header: "Cuotas pagas",
        enableSorting: false,
        meta: { align: "right", mobile: "secondary" },
        cell: ({ row }) =>
          `${row.original.paid_count}/${row.original.paid_count + row.original.pending_count}`,
      },
      {
        accessorKey: "pending_total",
        header: "Pendiente",
        meta: { align: "right", mobile: "primary" },
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatMoney(row.original.pending_total, row.original.currency)}
            <span className="text-muted-foreground ml-1 text-[10px]">
              ({row.original.pending_count})
            </span>
          </span>
        ),
      },
      {
        accessorKey: "next_due_date",
        header: "Próx. venc.",
        cell: ({ row }) =>
          row.original.next_due_date
            ? formatArgentineDate(row.original.next_due_date)
            : "—",
        meta: {
          headerClassName: "w-28",
          cellClassName: "text-sm",
          mobile: "secondary",
        },
      },
      {
        id: "status",
        header: "Estado",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge
            variant={row.original.status === "active" ? "secondary" : "outline"}
          >
            {LOAN_STATUS_LABEL[row.original.status]}
          </Badge>
        ),
        meta: { headerClassName: "w-28", mobile: "primary" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12", mobile: "primary" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Acciones" variant="ghost">
                <MoreHorizontal className="size-4" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/loans/${row.original.id}`}>Ver cuotas</Link>
              </DropdownMenuItem>
              {canWrite && canCancelLoan(row.original) && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => handleCancel(row.original)}
                >
                  <Ban className="size-4" />
                  Anular
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];
  }, [confirm, cancelMut, canWrite]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Préstamos, leasings y planes de ahorro"
        description="Capital, cuotas y pagos. Las cuotas pendientes se proyectan en el flujo de caja."
        actions={
          canWrite && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Nuevo préstamo
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        data={loans}
        getRowId={(l) => l.id}
        emptyMessage={
          canWrite ? "Sin préstamos. Agregá el primero." : "Sin préstamos."
        }
      />

      <LoanDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
