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
import { Switch } from "@/components/ui/switch";

import {
  useDeleteProduct,
  useProducts,
  useSetProductActive,
} from "../hooks/use-products";
import type { Product } from "../schema";

import { ProductDialog } from "./product-dialog";

export function ProductsTable({
  clientOptions,
}: {
  clientOptions: { id: string; legal_name: string }[];
}) {
  const { data: items } = useProducts();
  const deleteMut = useDeleteProduct();
  const toggleMut = useSetProductActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; product: Product } | null
  >(null);

  const columns = useMemo<ColumnDef<Product>[]>(() => {
    async function handleDelete(p: Product) {
      const ok = await confirm({
        title: `Borrar ${p.name}`,
        description: "Esta acción no se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(p.id, {
        onSuccess: () => toast.success("Producto borrado."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "name",
        header: "Producto",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        id: "client",
        header: "Cliente",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.client?.legal_name ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "sku",
        header: "SKU",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.sku ?? "—"}</span>
        ),
        meta: { headerClassName: "w-40" },
      },
      {
        accessorKey: "unit",
        header: "Unidad",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.unit ?? "—"}</span>
        ),
        meta: { headerClassName: "w-28" },
      },
      {
        accessorKey: "is_active",
        header: "Activo",
        cell: ({ row }) => (
          <Switch
            checked={row.original.is_active}
            onCheckedChange={(v) =>
              toggleMut.mutate(
                { id: row.original.id, is_active: v },
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
                  setDialog({ mode: "edit", product: row.original })
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
          <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
          <p className="text-muted-foreground text-sm">
            Catálogo de productos por cliente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton resource="products" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nuevo producto
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(p) => p.id}
        emptyMessage="Sin productos. Agregá el primero."
      />

      {dialog && (
        <ProductDialog
          mode={dialog.mode}
          product={dialog.mode === "edit" ? dialog.product : undefined}
          clientOptions={clientOptions}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
