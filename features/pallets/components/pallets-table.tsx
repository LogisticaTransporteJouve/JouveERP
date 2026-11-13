"use client";

import {
  Layers,
  Lock,
  LockOpen,
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
import { IconButton } from "@/components/ui/icon-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";

import { useDeletePallet, usePallets } from "../hooks/use-pallets";
import { PALLET_STATUS_LABELS, type Pallet } from "../schema";

import type { AreaOption } from "./area-select";
import { BlockPalletDialog } from "./block-pallet-dialog";
import { BulkPalletDialog } from "./bulk-pallet-dialog";
import { DispatchPalletsDialog } from "./dispatch-pallets-dialog";
import { PalletDialog } from "./pallet-dialog";
import { ClientOptionsReadError } from "./client-options-read-error";
import { formatArgentineDate } from "@/lib/format";

export function PalletsTable({
  warehouseOptions,
  clientOptions,
  productOptions,
  areaOptions,
  canWrite,
  canMoveStock,
}: {
  warehouseOptions: { id: string; name: string }[];
  /** null: the clients could not be read. */
  clientOptions: { id: string; legal_name: string }[] | null;
  productOptions: { id: string; name: string }[];
  areaOptions: AreaOption[];
  /** pallets:write: edit and block. */
  canWrite: boolean;
  /** pallets:write + stock_movements:write: create, dispatch, delete and
   *  the stock fields of an edit (same predicate as the actions). */
  canMoveStock: boolean;
}) {
  const { data: items } = usePallets();
  const deleteMut = useDeletePallet();
  const [blocking, setBlocking] = useState<{
    pallet: Pallet;
    mode: "block" | "unblock";
  } | null>(null);
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

  // Only pallets still in deposit and not blocked can be dispatched.
  const selectableIds = useMemo(
    () => filtered.filter(isDispatchable).map((p) => p.id),
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

    const selectColumn: ColumnDef<Pallet> = {
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
        isDispatchable(row.original) ? (
          <Checkbox
            checked={selected.has(row.original.id)}
            onCheckedChange={() => toggleOne(row.original.id)}
            aria-label={`Seleccionar ${row.original.code}`}
          />
        ) : null,
    };

    return [
      ...(canMoveStock ? [selectColumn] : []),
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
        id: "area",
        header: "Área",
        enableSorting: false,
        cell: ({ row }) => row.original.area?.name ?? "—",
        meta: { cellClassName: "text-sm", mobile: "secondary" },
      },
      {
        id: "lot",
        header: "Lote",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.lot_number ? (
            <div className="text-sm">
              <div className="font-mono text-xs">{row.original.lot_number}</div>
              {row.original.lot_expiry && (
                <div className="text-muted-foreground text-xs">
                  Vence {row.original.lot_expiry}
                </div>
              )}
            </div>
          ) : (
            "—"
          ),
        meta: { mobile: "secondary" },
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
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary">
              {PALLET_STATUS_LABELS[row.original.status]}
            </Badge>
            {row.original.blocked_at && (
              <Badge
                variant="outline"
                title={row.original.block_reason ?? undefined}
              >
                <Lock className="size-3" />
                Bloqueado
              </Badge>
            )}
          </div>
        ),
        meta: { headerClassName: "w-32", mobile: "primary" },
      },
      {
        accessorKey: "entry_date",
        header: "Ingreso",
        cell: ({ row }) => formatArgentineDate(row.original.entry_date),
        meta: {
          headerClassName: "w-32",
          cellClassName: "text-sm",
          mobile: "secondary",
        },
      },
      {
        accessorKey: "exit_date",
        header: "Salida",
        cell: ({ row }) => formatArgentineDate(row.original.exit_date),
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
        cell: ({ row }) =>
          canWrite ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Acciones" variant="ghost">
                  <MoreHorizontal className="size-4" />
                </IconButton>
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
                {row.original.blocked_at ? (
                  <DropdownMenuItem
                    onClick={() =>
                      setBlocking({ pallet: row.original, mode: "unblock" })
                    }
                  >
                    <LockOpen className="size-4" />
                    Desbloquear
                  </DropdownMenuItem>
                ) : row.original.status === "en_deposito" &&
                  !row.original.exit_date ? (
                  <DropdownMenuItem
                    onClick={() =>
                      setBlocking({ pallet: row.original, mode: "block" })
                    }
                  >
                    <Lock className="size-4" />
                    Bloquear
                  </DropdownMenuItem>
                ) : null}
                {canMoveStock && (
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
          ) : null,
      },
    ];
  }, [
    confirm,
    deleteMut,
    selected,
    selectableIds,
    headerChecked,
    canWrite,
    canMoveStock,
  ]);

  const selectedCount = selected.size;

  return (
    <>
      <PageHeader
        title="Pallets"
        description="Unidades físicas almacenadas por depósito y cliente."
        actions={
          <>
            {canMoveStock && selectedCount > 0 && (
              <Button onClick={() => setDispatchOpen(true)}>
                <Truck />
                Despachar ({selectedCount})
              </Button>
            )}
            <ExportButton resource="pallets" />
            {canMoveStock && (
              <>
                <Button variant="outline" onClick={() => setBulkOpen(true)}>
                  <Layers />
                  Cargar varios
                </Button>
                <Button onClick={() => setDialog({ mode: "create" })}>
                  <Plus />
                  Nuevo pallet
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="flex items-center gap-2">
        <Combobox
          options={(clientOptions ?? []).map((c) => ({
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
        <ClientOptionsReadError clientOptions={clientOptions} />
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
          areaOptions={areaOptions}
          canMoveStock={canMoveStock}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      {blocking && (
        <BlockPalletDialog
          pallet={blocking.pallet}
          mode={blocking.mode}
          open
          onOpenChange={(o) => {
            if (!o) setBlocking(null);
          }}
        />
      )}

      <BulkPalletDialog
        warehouseOptions={warehouseOptions}
        clientOptions={clientOptions}
        productOptions={productOptions}
        areaOptions={areaOptions}
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

function isDispatchable(p: Pallet): boolean {
  return p.status === "en_deposito" && p.blocked_at === null;
}
