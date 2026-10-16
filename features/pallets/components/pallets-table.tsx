"use client";

import {
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ExportButton } from "@/components/export-button";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
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
import { DispatchPalletsDialog } from "./dispatch-pallets-dialog";
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
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [clientFilter, setClientFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () =>
      clientFilter ? items.filter((p) => p.client_id === clientFilter) : items,
    [items, clientFilter],
  );

  // Only pallets still in deposit can be dispatched (selected).
  const selectableIds = useMemo(
    () => filtered.filter((p) => p.status === "en_deposito").map((p) => p.id),
    [filtered],
  );

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));
  const headerChecked = allSelected
    ? true
    : someSelected
      ? "indeterminate"
      : false;

  const columns = useMemo<ColumnDef<Pallet>[]>(() => {
    function toggleOne(id: string) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }

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
        id: "select",
        header: () => (
          <Checkbox
            checked={headerChecked}
            onCheckedChange={(v) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (v) selectableIds.forEach((id) => next.add(id));
                else selectableIds.forEach((id) => next.delete(id));
                return next;
              })
            }
            aria-label="Seleccionar todos"
            disabled={selectableIds.length === 0}
          />
        ),
        enableSorting: false,
        meta: { headerClassName: "w-10", mobile: "primary" },
        cell: ({ row }) =>
          row.original.status === "en_deposito" ? (
            <Checkbox
              checked={selected.has(row.original.id)}
              onCheckedChange={() => toggleOne(row.original.id)}
              aria-label={`Seleccionar ${row.original.code}`}
            />
          ) : null,
      },
      {
        accessorKey: "code",
        header: "Código",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.code}</span>
        ),
        meta: { headerClassName: "w-32", mobile: "primary" },
      },
      {
        id: "warehouse",
        header: "Depósito",
        enableSorting: false,
        cell: ({ row }) => row.original.warehouse?.name ?? "—",
        meta: { cellClassName: "text-sm", mobile: "secondary" },
      },
      {
        id: "client",
        header: "Cliente",
        enableSorting: false,
        cell: ({ row }) => row.original.client?.legal_name ?? "—",
        meta: { cellClassName: "text-sm", mobile: "secondary" },
      },
      {
        id: "product",
        header: "Producto",
        enableSorting: false,
        cell: ({ row }) => row.original.product?.name ?? "—",
        meta: { cellClassName: "text-sm", mobile: "secondary" },
      },
      {
        accessorKey: "quantity",
        header: "Cant.",
        cell: ({ row }) => row.original.quantity ?? "—",
        meta: {
          headerClassName: "w-24",
          cellClassName: "text-sm",
          mobile: "primary",
        },
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
        meta: { headerClassName: "w-32", mobile: "primary" },
      },
      {
        accessorKey: "entry_date",
        header: "Ingreso",
        cell: ({ row }) => row.original.entry_date,
        meta: {
          headerClassName: "w-32",
          cellClassName: "text-sm",
          mobile: "secondary",
        },
      },
      {
        accessorKey: "exit_date",
        header: "Salida",
        cell: ({ row }) => row.original.exit_date ?? "—",
        meta: {
          headerClassName: "w-32",
          cellClassName: "text-sm",
          mobile: "secondary",
        },
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
              <DropdownMenuItem
                onClick={() =>
                  setDialog({ mode: "edit", pallet: row.original })
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
  }, [confirm, deleteMut, selected, selectableIds, headerChecked]);

  const selectedCount = selected.size;

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
          {selectedCount > 0 && (
            <Button onClick={() => setDispatchOpen(true)}>
              <Truck />
              Despachar ({selectedCount})
            </Button>
          )}
          <ExportButton resource="pallets" />
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

      <div className="flex items-center gap-2">
        <Combobox
          options={clientOptions.map((c) => ({
            value: c.id,
            label: c.legal_name,
          }))}
          value={clientFilter}
          onChange={setClientFilter}
          placeholder="Todos los clientes"
          searchPlaceholder="Buscar cliente…"
          emptyText="Sin clientes."
          className="w-72"
        />
        {clientFilter && (
          <Button variant="ghost" size="sm" onClick={() => setClientFilter("")}>
            Limpiar
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filtered}
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

      <DispatchPalletsDialog
        palletIds={[...selected]}
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        onDispatched={() => setSelected(new Set())}
      />
    </>
  );
}
