"use client";

import {
  FileUp,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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
import { PageHeader } from "@/components/ui/page-header";
import { userCan, type Access } from "@/lib/auth/permissions";
import type { CostVoucherAccess } from "@/lib/cost-vouchers";

import { useDeleteFuelLoad, useFuelLoads } from "../hooks/use-fuel";
import type { FuelLoad } from "../schema";

import { FuelDialog } from "./fuel-dialog";
import { FuelImportDialog } from "./fuel-import-dialog";
import { FuelTicketDialog, type FuelFileAccess } from "./fuel-ticket-dialog";

function formatMoney(n: number) {
  return `$${n.toLocaleString("es-AR")}`;
}

export function FuelTable({
  actorAccess,
  vehicleOptions,
  tripOptions,
  voucherAccess,
  fileAccess,
}: {
  actorAccess: Access;
  vehicleOptions: { id: string; patente: string }[];
  tripOptions: {
    id: string;
    trip_date: string;
    origin: string | null;
    destination: string | null;
  }[];
  voucherAccess: CostVoucherAccess;
  /** null: the user cannot read files, so tickets are not offered. */
  fileAccess: FuelFileAccess | null;
}) {
  // The permission the load and import actions check. The ticket keeps
  // its own fileAccess.
  const canWrite = userCan(actorAccess, "fuel:write");
  const { data: items } = useFuelLoads();
  const deleteMut = useDeleteFuelLoad();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; fuelLoad: FuelLoad } | null
  >(null);
  const [importing, setImporting] = useState(false);
  const [ticketOf, setTicketOf] = useState<FuelLoad | null>(null);

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
        cell: ({ row }) =>
          (canWrite || fileAccess) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Acciones" variant="ghost">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canWrite && (
                  <DropdownMenuItem
                    onClick={() =>
                      setDialog({ mode: "edit", fuelLoad: row.original })
                    }
                  >
                    <Pencil className="size-4" />
                    Editar
                  </DropdownMenuItem>
                )}
                {fileAccess && (
                  <DropdownMenuItem onClick={() => setTicketOf(row.original)}>
                    <Paperclip className="size-4" />
                    Ticket o remito
                  </DropdownMenuItem>
                )}
                {canWrite && (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => handleDelete(row.original)}
                  >
                    <Trash2 className="size-4" />
                    Borrar
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ),
      },
    ];
  }, [canWrite, confirm, deleteMut, fileAccess]);

  return (
    <>
      <PageHeader
        title="Cargas de combustible"
        description="Cargas de combustible de la flota por vehículo."
        actions={
          <>
            <ExportButton resource="fuel" />
            {canWrite && (
              <>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  <FileUp />
                  Importar resumen
                </Button>
                <Button onClick={() => setDialog({ mode: "create" })}>
                  <Plus />
                  Nueva carga
                </Button>
              </>
            )}
          </>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        getRowId={(f) => f.id}
        emptyMessage="Sin cargas. Agregá la primera."
      />

      {canWrite && (
        <FuelImportDialog open={importing} onOpenChange={setImporting} />
      )}
      {fileAccess && (
        <FuelTicketDialog
          fuelLoad={ticketOf}
          access={fileAccess}
          onOpenChange={(o) => {
            if (!o) setTicketOf(null);
          }}
        />
      )}

      {canWrite && dialog && (
        <FuelDialog
          mode={dialog.mode}
          fuelLoad={dialog.mode === "edit" ? dialog.fuelLoad : undefined}
          vehicleOptions={vehicleOptions}
          tripOptions={tripOptions}
          voucherAccess={voucherAccess}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
