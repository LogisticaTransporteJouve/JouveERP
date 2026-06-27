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

import { useDeleteMaintenance, useMaintenance } from "../hooks/use-maintenance";
import { MAINTENANCE_KIND_LABELS, type MaintenanceRecord } from "../schema";

import { MaintenanceDialog } from "./maintenance-dialog";

function formatMoney(n: number | null) {
  if (n === null) return "—";
  return `$${n.toLocaleString("es-AR")}`;
}

export function MaintenanceTable({
  vehicleOptions,
}: {
  vehicleOptions: { id: string; patente: string }[];
}) {
  const { data: items } = useMaintenance();
  const deleteMut = useDeleteMaintenance();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; record: MaintenanceRecord }
    | null
  >(null);

  const columns = useMemo<ColumnDef<MaintenanceRecord>[]>(() => {
    async function handleDelete(r: MaintenanceRecord) {
      const ok = await confirm({
        title: `Borrar mantenimiento del ${r.service_date}`,
        description: "Esta acción no se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(r.id, {
        onSuccess: () => toast.success("Mantenimiento borrado."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "service_date",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.service_date}</span>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        id: "vehicle",
        header: "Vehículo",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.vehicle?.patente ?? "—"}
          </span>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        accessorKey: "kind",
        header: "Tipo",
        cell: ({ row }) => (
          <Badge variant="secondary">
            {MAINTENANCE_KIND_LABELS[row.original.kind]}
          </Badge>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        accessorKey: "description",
        header: "Descripción",
        cell: ({ row }) => row.original.description,
        meta: { cellClassName: "text-sm" },
      },
      {
        accessorKey: "cost",
        header: "Costo",
        cell: ({ row }) => formatMoney(row.original.cost),
        meta: { headerClassName: "w-32", cellClassName: "text-sm" },
      },
      {
        accessorKey: "next_service_date",
        header: "Próx. service",
        cell: ({ row }) => row.original.next_service_date ?? "—",
        meta: { headerClassName: "w-32", cellClassName: "text-sm" },
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
                  setDialog({ mode: "edit", record: row.original })
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
  }, [confirm, deleteMut]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Mantenimientos
          </h1>
          <p className="text-muted-foreground text-sm">
            Mantenimientos de la flota: service, reparaciones y próximos
            vencimientos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPdfButton resource="maintenance" label="Exportar PDF" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nuevo mantenimiento
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(r) => r.id}
        emptyMessage="Sin mantenimientos. Agregá el primero."
      />

      {dialog && (
        <MaintenanceDialog
          mode={dialog.mode}
          record={dialog.mode === "edit" ? dialog.record : undefined}
          vehicleOptions={vehicleOptions}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
