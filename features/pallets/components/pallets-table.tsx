"use client";

import { Layers, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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

import { useDeletePallet, usePallets } from "../hooks/use-pallets";
import { PALLET_STATUS_LABELS, type Pallet } from "../schema";

import { BulkPalletDialog } from "./bulk-pallet-dialog";
import { PalletDialog } from "./pallet-dialog";

export function PalletsTable({
  warehouseOptions,
  clientOptions,
  productOptions,
}: {
  warehouseOptions: { id: string; name: string }[];
  clientOptions: { id: string; legal_name: string }[];
  productOptions: { id: string; name: string }[];
}) {
  const { data: items } = usePallets();
  const deleteMut = useDeletePallet();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; pallet: Pallet } | null
  >(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const columns = useMemo<ColumnDef<Pallet>[]>(() => {
    async function handleDelete(p: Pallet) {
      const ok = await confirm({
        title: `Borrar pallet ${p.code}`,
        description: "Esta acción no se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(p.id, {
        onSuccess: () => toast.success("Pallet borrado."),
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
        id: "warehouse",
        header: "Depósito",
        enableSorting: false,
        cell: ({ row }) => row.original.warehouse?.name ?? "—",
        meta: { cellClassName: "text-sm" },
      },
      {
        id: "client",
        header: "Cliente",
        enableSorting: false,
        cell: ({ row }) => row.original.client?.legal_name ?? "—",
        meta: { cellClassName: "text-sm" },
      },
      {
        id: "product",
        header: "Producto",
        enableSorting: false,
        cell: ({ row }) => row.original.product?.name ?? "—",
        meta: { cellClassName: "text-sm" },
      },
      {
        accessorKey: "quantity",
        header: "Cant.",
        cell: ({ row }) => row.original.quantity ?? "—",
        meta: { headerClassName: "w-24", cellClassName: "text-sm" },
      },
      {
        id: "status",
        header: "Estado",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge variant="secondary">
            {PALLET_STATUS_LABELS[row.original.status]}
          </Badge>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        accessorKey: "entry_date",
        header: "Ingreso",
        cell: ({ row }) => row.original.entry_date,
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
                onClick={() => setDialog({ mode: "edit", pallet: row.original })}
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
          <h1 className="text-2xl font-semibold tracking-tight">Pallets</h1>
          <p className="text-muted-foreground text-sm">
            Unidades físicas almacenadas por depósito y cliente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPdfButton resource="pallets" label="Exportar PDF" />
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <Layers />
            Cargar varios
          </Button>
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nuevo pallet
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(p) => p.id}
        emptyMessage="Sin pallets. Agregá el primero."
      />

      {dialog && (
        <PalletDialog
          mode={dialog.mode}
          pallet={dialog.mode === "edit" ? dialog.pallet : undefined}
          warehouseOptions={warehouseOptions}
          clientOptions={clientOptions}
          productOptions={productOptions}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      <BulkPalletDialog
        warehouseOptions={warehouseOptions}
        clientOptions={clientOptions}
        productOptions={productOptions}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
      />
    </>
  );
}
