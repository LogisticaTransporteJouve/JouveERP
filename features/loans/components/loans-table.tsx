"use client";

import { Ban, MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/format";

import { useCancelLoan, useLoans } from "../hooks/use-loans";
import {
  LOAN_KIND_LABEL,
  LOAN_STATUS_LABEL,
  type LoanListItem,
} from "../schema";

import { LoanDialog } from "./loan-dialog";

export function LoansTable({
  channelOptions,
}: {
  channelOptions: { id: string; name: string; is_fiscal: boolean }[];
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
          "El préstamo queda anulado y deja de proyectarse en el flujo de caja. Los pagos ya registrados no se tocan.",
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
          </div>
        ),
      },
      {
        id: "lender",
        header: "Acreedor",
        enableSorting: false,
        cell: ({ row }) => row.original.lender ?? "—",
        meta: { cellClassName: "text-sm", mobile: "secondary" },
      },
      {
        id: "channel",
        header: "Canal",
        enableSorting: false,
        cell: ({ row }) => row.original.channel_name ?? "—",
        meta: { cellClassName: "text-sm", mobile: "secondary" },
      },
      {
        accessorKey: "principal",
        header: "Capital",
        meta: { align: "right", mobile: "secondary" },
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatMoney(row.original.principal)}
          </span>
        ),
      },
      {
        accessorKey: "paid_total",
        header: "Pagado",
        meta: { align: "right", mobile: "secondary" },
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatMoney(row.original.paid_total)}
          </span>
        ),
      },
      {
        accessorKey: "pending_total",
        header: "Pendiente",
        meta: { align: "right", mobile: "primary" },
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            {formatMoney(row.original.pending_total)}
            <span className="text-muted-foreground ml-1 text-[10px]">
              ({row.original.pending_count})
            </span>
          </span>
        ),
      },
      {
        accessorKey: "next_due_date",
        header: "Próx. venc.",
        cell: ({ row }) => row.original.next_due_date ?? "—",
        meta: { headerClassName: "w-28", cellClassName: "text-sm", mobile: "secondary" },
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
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/loans/${row.original.id}`}>Ver cuotas</Link>
              </DropdownMenuItem>
              {row.original.status === "active" && (
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
  }, [confirm, cancelMut]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Préstamos y leasing
          </h1>
          <p className="text-muted-foreground text-sm">
            Capital, cuotas y pagos. Las cuotas pendientes se proyectan en el
            flujo de caja.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Nuevo préstamo
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={loans}
        getRowId={(l) => l.id}
        emptyMessage="Sin préstamos. Agregá el primero."
      />

      <LoanDialog
        channelOptions={channelOptions}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
