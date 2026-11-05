"use client";

import { LayoutGrid, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ExportButton } from "@/components/export-button";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { userCan, type Access } from "@/lib/auth/permissions";

import {
  useDeleteWarehouse,
  useSetWarehouseActive,
  useWarehouses,
} from "../hooks/use-warehouses";
import type { Warehouse } from "../schema";

import { StorageAreasDialog } from "./storage-areas-dialog";
import { WarehouseDialog } from "./warehouse-dialog";

export function WarehousesTable({ actorAccess }: { actorAccess: Access }) {
  // The permission every warehouse and storage-area write action checks
  // («Activo» and the «Áreas» editor included).
  const canWrite = userCan(actorAccess, "warehouses:write");
  const { data: items } = useWarehouses();
  const deleteMut = useDeleteWarehouse();
  const toggleMut = useSetWarehouseActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; warehouse: Warehouse } | null
  >(null);
  const [areasFor, setAreasFor] = useState<Warehouse | null>(null);

  const columns = useMemo<ColumnDef<Warehouse>[]>(() => {
    async function handleDelete(w: Warehouse) {
      const ok = await confirm({
        title: `Borrar ${w.name}`,
        description: "Esta acción no se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(w.id, {
        onSuccess: () => toast.success("Depósito borrado."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "name",
        header: "Nombre",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "address",
        header: "Dirección",
        cell: ({ row }) => row.original.address ?? "—",
        meta: { cellClassName: "text-sm" },
      },
      {
        accessorKey: "capacity_pallets",
        header: "Capacidad (pallets)",
        cell: ({ row }) => row.original.capacity_pallets ?? "—",
        meta: { headerClassName: "w-40", cellClassName: "text-sm" },
      },
      {
        accessorKey: "is_active",
        header: "Activo",
        enableSorting: false,
        meta: { headerClassName: "w-20" },
        cell: ({ row }) => (
          <Switch
            checked={row.original.is_active}
            disabled={!canWrite}
            onCheckedChange={(v) =>
              toggleMut.mutate(
                { id: row.original.id, is_active: v },
                { onError: (err) => toast.error(err.message) },
              )
            }
            aria-label="Activo"
          />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12" },
        cell: ({ row }) =>
          canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Acciones" variant="ghost">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    setDialog({ mode: "edit", warehouse: row.original })
                  }
                >
                  <Pencil className="size-4" />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAreasFor(row.original)}>
                  <LayoutGrid className="size-4" />
                  Áreas
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
  }, [canWrite, confirm, deleteMut, toggleMut]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Depósitos</h1>
          <p className="text-muted-foreground text-sm">
            Depósitos físicos para almacenamiento de mercadería.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton resource="warehouses" />
          {canWrite && (
            <Button onClick={() => setDialog({ mode: "create" })}>
              <Plus />
              Nuevo depósito
            </Button>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(w) => w.id}
        emptyMessage="Sin depósitos. Agregá el primero."
      />

      {canWrite && dialog && (
        <WarehouseDialog
          mode={dialog.mode}
          warehouse={dialog.mode === "edit" ? dialog.warehouse : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      {canWrite && areasFor && (
        <StorageAreasDialog
          warehouse={areasFor}
          open={areasFor !== null}
          onOpenChange={(o) => {
            if (!o) setAreasFor(null);
          }}
        />
      )}
    </>
  );
}
