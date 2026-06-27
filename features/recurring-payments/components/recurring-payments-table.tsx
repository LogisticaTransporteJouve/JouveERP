"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ExportPdfButton } from "@/components/export-pdf-button";
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
import { Switch } from "@/components/ui/switch";

import {
  useDeleteRecurringPayment,
  useRecurringPayments,
  useSetRecurringPaymentActive,
} from "../hooks/use-recurring-payments";
import {
  RECURRING_CATEGORY_LABELS,
  RECURRING_FREQUENCY_LABELS,
  type RecurringPayment,
} from "../schema";

import { RecurringPaymentDialog } from "./recurring-payment-dialog";

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function RecurringPaymentsTable() {
  const { data: items } = useRecurringPayments();
  const deleteMut = useDeleteRecurringPayment();
  const toggleMut = useSetRecurringPaymentActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; payment: RecurringPayment } | null
  >(null);

  const columns = useMemo<ColumnDef<RecurringPayment>[]>(() => {
    async function handleDelete(p: RecurringPayment) {
      const ok = await confirm({
        title: `Borrar "${p.description}"`,
        description: "Se elimina el pago recurrente. No se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(p.id, {
        onSuccess: () => toast.success("Pago borrado."),
        onError: (err) => toast.error(err.message),
      });
    }

    function handleToggle(p: RecurringPayment) {
      toggleMut.mutate(
        { id: p.id, is_active: !p.is_active },
        { onError: (err) => toast.error(err.message) },
      );
    }

    return [
      {
        accessorKey: "description",
        header: "Descripción",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.description}</span>
        ),
      },
      {
        accessorKey: "category",
        header: "Categoría",
        cell: ({ row }) => (
          <Badge variant="outline">
            {RECURRING_CATEGORY_LABELS[row.original.category]}
          </Badge>
        ),
        meta: { headerClassName: "w-28" },
      },
      {
        accessorKey: "amount",
        header: "Monto",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {money(row.original.amount, row.original.currency)}
          </span>
        ),
        meta: { headerClassName: "w-36", align: "right" },
      },
      {
        accessorKey: "frequency",
        header: "Frecuencia",
        cell: ({ row }) => (
          <span className="text-sm">
            {RECURRING_FREQUENCY_LABELS[row.original.frequency]}
          </span>
        ),
        meta: { headerClassName: "w-24" },
      },
      {
        accessorKey: "next_due_date",
        header: "Próx. venc.",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.next_due_date}</span>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        accessorKey: "is_active",
        header: "Activo",
        cell: ({ row }) => (
          <Switch
            checked={row.original.is_active}
            onCheckedChange={() => handleToggle(row.original)}
            aria-label="Activo"
          />
        ),
        meta: { headerClassName: "w-20" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  setDialog({ mode: "edit", payment: row.original })
                }
              >
                <Pencil className="size-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => handleDelete(row.original)}
              >
                <Trash2 className="size-4" />
                Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];
  }, [confirm, deleteMut, toggleMut]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Pagos recurrentes
          </h1>
          <p className="text-muted-foreground text-sm">
            Compromisos que se repiten (alquiler, servicios, préstamos,
            impuestos, sueldos). Insumo del cash-flow proyectado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPdfButton resource="recurring-payments" label="Exportar PDF" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nuevo pago
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(p) => p.id}
        emptyMessage="Sin pagos recurrentes. Agregá el primero."
      />

      {dialog && (
        <RecurringPaymentDialog
          mode={dialog.mode}
          payment={dialog.mode === "edit" ? dialog.payment : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
