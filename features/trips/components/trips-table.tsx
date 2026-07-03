"use client";

import { MoreHorizontal, Package, Pencil, Plus, Trash2 } from "lucide-react";
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

import { useDeleteTrip, useTrips } from "../hooks/use-trips";
import { TRIP_STATUS_LABELS, type Trip } from "../schema";

import { TripDialog } from "./trip-dialog";

function formatMoney(n: number | null) {
  if (n === null) return "—";
  return `$${n.toLocaleString("es-AR")}`;
}

export function TripsTable({
  driverOptions,
  vehicleOptions,
}: {
  driverOptions: { id: string; full_name: string }[];
  vehicleOptions: { id: string; patente: string }[];
}) {
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
        onSuccess: () => toast.success("Viaje borrado."),
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
        cell: ({ row }) => (
          <span className="text-sm">{row.original.driver?.full_name ?? "—"}</span>
        ),
        meta: { mobile: "secondary" },
      },
      {
        accessorKey: "vehicle",
        header: "Vehículo",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.vehicle?.patente ?? "—"}
          </span>
        ),
        meta: { headerClassName: "w-32", mobile: "secondary" },
      },
      {
        id: "route",
        header: "Origen → Destino",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.origin ?? "—"} → {row.original.destination ?? "—"}
          </span>
        ),
        meta: { mobile: "primary" },
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
        accessorKey: "revenue",
        header: "Ingreso",
        cell: ({ row }) => (
          <span className="text-sm">{formatMoney(row.original.revenue)}</span>
        ),
        meta: { headerClassName: "w-32", mobile: "secondary" },
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
                <Link href={`/trips/${row.original.id}`}>
                  <Package className="size-4" />
                  Ver cargas
                </Link>
              </DropdownMenuItem>
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
          <h1 className="text-2xl font-semibold tracking-tight">Viajes</h1>
          <p className="text-muted-foreground text-sm">
            Viajes de la flota con chofer, vehículo y resultado.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nuevo viaje
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(t) => t.id}
        emptyMessage="Sin viajes. Agregá el primero."
      />

      {dialog && (
        <TripDialog
          mode={dialog.mode}
          trip={dialog.mode === "edit" ? dialog.trip : undefined}
          driverOptions={driverOptions}
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
