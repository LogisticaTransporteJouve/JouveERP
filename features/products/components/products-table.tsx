"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
          <p className="text-muted-foreground text-sm">
            Catálogo de productos por cliente.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nuevo producto
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="w-40">SKU</TableHead>
              <TableHead className="w-28">Unidad</TableHead>
              <TableHead className="w-20">Activo</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  Sin productos. Agregá el primero.
                </TableCell>
              </TableRow>
            ) : (
              items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-sm">
                    {p.client?.legal_name ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.sku ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{p.unit ?? "—"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={p.is_active}
                      onCheckedChange={(v) =>
                        toggleMut.mutate(
                          { id: p.id, is_active: v },
                          { onError: (err) => toast.error(err.message) },
                        )
                      }
                      aria-label="Activo"
                    />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            setDialog({ mode: "edit", product: p })
                          }
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(p)}
                        >
                          <Trash2 className="size-4" />
                          Borrar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
