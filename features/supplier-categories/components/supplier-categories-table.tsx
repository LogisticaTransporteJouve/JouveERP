"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExportButton } from "@/components/export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  useDeleteSupplierCategory,
  useSupplierCategories,
} from "../hooks/use-supplier-categories";
import type { SupplierCategory } from "../schema";
import { SupplierCategoryDialog } from "./supplier-category-dialog";

export function SupplierCategoriesTable() {
  const { data: categories } = useSupplierCategories();
  const deleteMut = useDeleteSupplierCategory();

  const [dialogState, setDialogState] = useState<
    { mode: "create" } | { mode: "edit"; category: SupplierCategory } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<SupplierCategory | null>(
    null,
  );

  function handleDelete() {
    if (!confirmDelete) return;
    deleteMut.mutate(confirmDelete.id, {
      onSuccess: () => {
        toast.success("Categoría borrada.");
        setConfirmDelete(null);
      },
      onError: (err) => {
        toast.error(err.message);
        setConfirmDelete(null);
      },
    });
  }

  const columns = useMemo<ColumnDef<SupplierCategory>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Nombre",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "slug",
        header: "Slug",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.slug}
          </span>
        ),
      },
      {
        accessorKey: "is_active",
        header: "Estado",
        cell: ({ row }) =>
          row.original.is_active ? (
            <Badge variant="secondary">Activa</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Inactiva
            </Badge>
          ),
        meta: { headerClassName: "w-24" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12" },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Acciones">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  setDialogState({ mode: "edit", category: row.original })
                }
              >
                <Pencil className="size-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setConfirmDelete(row.original)}
                variant="destructive"
              >
                <Trash2 className="size-4" />
                Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Categorías de proveedores
          </h1>
          <p className="text-sm text-muted-foreground">
            Clasificá los proveedores para filtrar y agrupar gastos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton resource="supplier-categories" />
          <Button onClick={() => setDialogState({ mode: "create" })}>
            <Plus />
            Nueva categoría
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={categories}
        getRowId={(cat) => cat.id}
        emptyMessage="Sin categorías. Creá la primera para empezar a clasificar proveedores."
      />

      <SupplierCategoryDialog
        mode={dialogState?.mode ?? "create"}
        category={
          dialogState?.mode === "edit" ? dialogState.category : undefined
        }
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) setDialogState(null);
        }}
      />

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar categoría?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará &ldquo;{confirmDelete?.name}&rdquo;. Si hay
              proveedores asignados a esta categoría, el sistema te va a avisar
              para que los reasignes antes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMut.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Borrando…" : "Borrar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
