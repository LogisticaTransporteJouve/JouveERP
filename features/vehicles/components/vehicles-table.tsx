"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ExportPdfButton } from "@/components/export-pdf-button";
import { useConfirm } from "@/components/providers/confirm-provider";
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
  useDeleteVehicle,
  useSetVehicleActive,
  useVehicles,
} from "../hooks/use-vehicles";
import { VEHICLE_TYPE_LABELS, type Vehicle } from "../schema";

import { VehicleDialog } from "./vehicle-dialog";

export function VehiclesTable() {
  const { data: items } = useVehicles();
  const deleteMut = useDeleteVehicle();
  const toggleMut = useSetVehicleActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; vehicle: Vehicle } | null
  >(null);

  const columns = useMemo<ColumnDef<Vehicle>[]>(() => {
    async function handleDelete(v: Vehicle) {
      const ok = await confirm({
        title: `Borrar ${v.patente}`,
        description: "Si tiene viajes, quedan sin vehículo asignado.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(v.id, {
        onSuccess: () => toast.success("Vehículo borrado."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "patente",
        header: "Patente",
        cell: ({ row }) => (
          <span className="font-mono font-medium">{row.original.patente}</span>
        ),
      },
      {
        accessorKey: "alias",
        header: "Alias",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.alias ?? "—"}</span>
        ),
        meta: { headerClassName: "w-40" },
      },
      {
        accessorKey: "vehicle_type",
        header: "Tipo",
        cell: ({ row }) => (
          <span className="text-sm">
            {VEHICLE_TYPE_LABELS[row.original.vehicle_type]}
          </span>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        id: "brand_model",
        header: "Marca/Modelo",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.brand ?? "—"}
            {row.original.model ? ` ${row.original.model}` : ""}
          </span>
        ),
        meta: { headerClassName: "w-40" },
      },
      {
        accessorKey: "year",
        header: "Año",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.year ?? "—"}</span>
        ),
        meta: { headerClassName: "w-20" },
      },
      {
        accessorKey: "is_active",
        header: "Activo",
        cell: ({ row }) => (
          <Switch
            checked={row.original.is_active}
            onCheckedChange={(checked) =>
              toggleMut.mutate(
                { id: row.original.id, is_active: checked },
                { onError: (err) => toast.error(err.message) },
              )
            }
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
                  setDialog({ mode: "edit", vehicle: row.original })
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
          <h1 className="text-2xl font-semibold tracking-tight">Vehículos</h1>
          <p className="text-muted-foreground text-sm">
            Vehículos de la flota.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPdfButton resource="vehicles" label="Exportar PDF" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nuevo vehículo
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(v) => v.id}
        emptyMessage="Sin vehículos. Agregá el primero."
      />

      {dialog && (
        <VehicleDialog
          mode={dialog.mode}
          vehicle={dialog.mode === "edit" ? dialog.vehicle : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
