"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
import { PageHeader } from "@/components/ui/page-header";
import { VehicleKmDaysDialog } from "@/features/vehicle-km/components/vehicle-km-days-dialog";
import { userCan, type Access } from "@/lib/auth/permissions";

import {
  useDeleteVehicle,
  useSetVehicleActive,
  useVehicles,
} from "../hooks/use-vehicles";
import { VEHICLE_TYPE_LABELS, type Vehicle } from "../schema";

import { VehicleDialog } from "./vehicle-dialog";

export function VehiclesTable({ actorAccess }: { actorAccess: Access }) {
  // The permission every vehicle write action checks («Activo» included).
  const canWrite = userCan(actorAccess, "vehicles:write");
  const canSeeKm = userCan(actorAccess, "fleet_km:read");
  const [kmOf, setKmOf] = useState<Vehicle | null>(null);
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
        description:
          "Si tiene viajes, cargas de combustible, mantenimientos o documentos no se puede borrar: desactivalo.",
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
        cell: ({ row }) =>
          canSeeKm ? (
            <button
              type="button"
              className="font-mono font-medium underline-offset-4 hover:underline"
              title="Ver los km de Strix"
              onClick={() => setKmOf(row.original)}
            >
              {row.original.patente}
            </button>
          ) : (
            <span className="font-mono font-medium">
              {row.original.patente}
            </span>
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
            disabled={!canWrite}
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
  }, [canWrite, canSeeKm, confirm, deleteMut, toggleMut]);

  return (
    <>
      <PageHeader
        title="Vehículos"
        description="Vehículos de la flota."
        actions={
          <>
            <ExportButton resource="vehicles" />
            {canWrite && (
              <Button onClick={() => setDialog({ mode: "create" })}>
                <Plus />
                Nuevo vehículo
              </Button>
            )}
          </>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        getRowId={(v) => v.id}
        emptyMessage="Sin vehículos. Agregá el primero."
      />

      {canWrite && dialog && (
        <VehicleDialog
          mode={dialog.mode}
          vehicle={dialog.mode === "edit" ? dialog.vehicle : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      {kmOf && (
        <VehicleKmDaysDialog
          vehicle={{ id: kmOf.id, patente: kmOf.patente }}
          onOpenChange={(o) => {
            if (!o) setKmOf(null);
          }}
        />
      )}
    </>
  );
}
