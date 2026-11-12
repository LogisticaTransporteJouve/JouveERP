"use client";

import { MoreHorizontal, Package, Pencil, Plus, Trash2 } from "lucide-react";
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
import { userCan, userCanAll, type Access } from "@/lib/auth/permissions";

import { useDeleteTrip, useTrips } from "../hooks/use-trips";
import { TRIP_STATUS_LABELS, type Trip } from "../schema";

import { TripDialog } from "./trip-dialog";

export function TripsTable({
  actorAccess,
  driverOptions,
  vehicleOptions,
}: {
  actorAccess: Access;
  driverOptions: { id: string; full_name: string }[];
  vehicleOptions: { id: string; patente: string }[];
}) {
  // The permission the create, update and delete actions check.
  const canWrite = userCan(actorAccess, "trips:write");
  // «Ver cargas» opens a page whose cargas read checks shipments:read.
  const canSeeShipments = userCan(actorAccess, "shipments:read");
  // «Nuevo viaje» lists the cargas without a trip and assigns the picked ones.
  const canAssign = userCanAll(actorAccess, [
    "shipments:read",
    "shipments:write",
  ]);
  const { data: items } = useTrips();
  const deleteMut = useDeleteTrip();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; trip: Trip } | null
  >(null);

  const columns = useMemo<ColumnDef<Trip>[]>(() => {
    async function handleDelete(t: Trip) {
      const ok = await confirm({
        title: `Borrar viaje del ${t.trip_date}`,
        description: "Esta acción no se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(t.id, {
        onSuccess: ({ warning }) => {
          if (warning) toast.warning(`Viaje borrado. ${warning}`);
          else toast.success("Viaje borrado.");
        },
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "trip_date",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.trip_date}</span>
        ),
        meta: { headerClassName: "w-32", mobile: "primary" },
      },
      {
        accessorKey: "driver",
        header: "Chofer",
        cell: ({ row }) =>
          row.original.driver && row.original.driver_id ? (
            <Link
              href={`/drivers/${row.original.driver_id}`}
              className="text-sm underline-offset-4 hover:underline"
            >
              {row.original.driver.full_name}
            </Link>
          ) : (
            <span className="text-sm">—</span>
          ),
        meta: { mobile: "secondary" },
      },
      {
        accessorKey: "companion",
        header: "Acompañante",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.companion?.legal_name ?? "—"}
          </span>
        ),
        meta: { mobile: "secondary" },
      },
      {
        accessorKey: "vehicle",
        header: "Vehículo",
        cell: ({ row }) =>
          row.original.vehicle && row.original.vehicle_id ? (
            <Link
              href={`/vehicles/${row.original.vehicle_id}`}
              className="font-mono text-xs underline-offset-4 hover:underline"
            >
              {row.original.vehicle.patente}
            </Link>
          ) : (
            <span className="font-mono text-xs">—</span>
          ),
        meta: { headerClassName: "w-32", mobile: "secondary" },
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ row }) => (
          <Badge variant="secondary">
            {TRIP_STATUS_LABELS[row.original.status]}
          </Badge>
        ),
        meta: { headerClassName: "w-32", mobile: "primary" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12", mobile: "primary" },
        cell: ({ row }) =>
          (canSeeShipments || canWrite) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Acciones" variant="ghost">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canSeeShipments && (
                  <DropdownMenuItem asChild>
                    <Link href={`/trips/${row.original.id}`}>
                      <Package className="size-4" />
                      Ver cargas
                    </Link>
                  </DropdownMenuItem>
                )}
                {canWrite && (
                  <>
                    <DropdownMenuItem
                      onClick={() =>
                        setDialog({ mode: "edit", trip: row.original })
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
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ),
      },
    ];
  }, [canSeeShipments, canWrite, confirm, deleteMut]);

  return (
    <>
      <PageHeader
        title="Viajes"
        description="Viajes de la flota con fecha, estado, chofer, acompañante y vehículo."
        actions={
          canWrite && (
            <Button onClick={() => setDialog({ mode: "create" })}>
              <Plus />
              Nuevo viaje
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        data={items}
        getRowId={(t) => t.id}
        emptyMessage="Sin viajes. Agregá el primero."
      />

      {canWrite && dialog && (
        <TripDialog
          mode={dialog.mode}
          trip={dialog.mode === "edit" ? dialog.trip : undefined}
          driverOptions={driverOptions}
          vehicleOptions={vehicleOptions}
          canAssign={canAssign}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
