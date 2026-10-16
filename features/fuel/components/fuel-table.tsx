"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ExportButton } from "@/components/export-button";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useDeleteFuelLoad, useFuelLoads } from "../hooks/use-fuel";
import type { FuelLoad } from "../schema";

import { FuelDialog } from "./fuel-dialog";

function formatMoney(n: number) {
  return `$${n.toLocaleString("es-AR")}`;
}

export function FuelTable({
  vehicleOptions,
  tripOptions,
}: {
  vehicleOptions: { id: string; patente: string }[];
  tripOptions: {
    id: string;
    trip_date: string;
    origin: string | null;
    destination: string | null;
  }[];
}) {
  const { data: items } = useFuelLoads();
  const deleteMut = useDeleteFuelLoad();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; fuelLoad: FuelLoad } | null
  >(null);

  const columns = useMemo<ColumnDef<FuelLoad>[]>(() => {
    async function handleDelete(f: FuelLoad) {
      const ok = await confirm({
        title: `Borrar carga del ${f.load_date}`,
        description: "Esta acción no se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(f.id, {
        onSuccess: () => toast.success("Carga borrada."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "load_date",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.load_date}</span>
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
        accessorKey: "liters",
        header: "Litros",
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.liters.toLocaleString("es-AR")}
          </span>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        accessorKey: "amount",
        header: "Importe",
        cell: ({ row }) => (
          <span className="text-sm">{formatMoney(row.original.amount)}</span>
        ),
        meta: { headerClassName: "w-36" },
      },
      {
        accessorKey: "station",
        header: "Estación",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.station ?? "—"}</span>
        ),
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
                  setDialog({ mode: "edit", fuelLoad: row.original })
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
            Cargas de combustible
          </h1>
          <p className="text-muted-foreground text-sm">
            Cargas de combustible de la flota por vehículo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton resource="fuel" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nueva carga
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(f) => f.id}
        emptyMessage="Sin cargas. Agregá la primera."
      />

      {dialog && (
        <FuelDialog
          mode={dialog.mode}
          fuelLoad={dialog.mode === "edit" ? dialog.fuelLoad : undefined}
          vehicleOptions={vehicleOptions}
          tripOptions={tripOptions}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
