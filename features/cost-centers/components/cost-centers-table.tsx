"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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

import {
  useCostCenters,
  useDeleteCostCenter,
} from "../hooks/use-cost-centers";
import type { CostCenter } from "../schema";

import { CostCenterDialog } from "./cost-center-dialog";

export function CostCentersTable() {
  const { data: items } = useCostCenters();
  const deleteMut = useDeleteCostCenter();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; costCenter: CostCenter } | null
  >(null);

  const columns = useMemo<ColumnDef<CostCenter>[]>(() => {
    async function handleDelete(cc: CostCenter) {
      const ok = await confirm({
        title: `Borrar ${cc.code}`,
        description: "Si está en uso por algún movimiento, va a fallar.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(cc.id, {
        onSuccess: () => toast.success("Centro borrado."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "code",
        header: "Código",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.code}</span>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        accessorKey: "name",
        header: "Nombre",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "description",
        header: "Descripción",
        enableSorting: false,
        cell: ({ row }) => row.original.description ?? "—",
        meta: {
          cellClassName: "max-w-md truncate text-sm text-muted-foreground",
        },
      },
      {
        accessorKey: "is_active",
        header: "Estado",
        cell: ({ row }) =>
          row.original.is_active ? (
            <Badge variant="outline">Activo</Badge>
          ) : (
            <Badge variant="secondary">Inactivo</Badge>
          ),
        meta: { headerClassName: "w-24" },
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
                  setDialog({ mode: "edit", costCenter: row.original })
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
            Centros de costo
          </h1>
          <p className="text-sm text-muted-foreground">
            Dimensión opcional para clasificar movimientos y reportar EERR por
            flota / proyecto / obra.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nuevo centro
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(cc) => cc.id}
        emptyMessage="Sin centros de costo."
      />

      {dialog && (
        <CostCenterDialog
          mode={dialog.mode}
          costCenter={dialog.mode === "edit" ? dialog.costCenter : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
