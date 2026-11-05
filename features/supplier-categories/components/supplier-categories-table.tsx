"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
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
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { userCan, type Access } from "@/lib/auth/permissions";

import {
  useDeleteSupplierCategory,
  useSupplierCategories,
} from "../hooks/use-supplier-categories";
import type { SupplierCategory } from "../schema";
import { SupplierCategoryDialog } from "./supplier-category-dialog";

export function SupplierCategoriesTable({
  actorAccess,
}: {
  actorAccess: Access;
}) {
  // The permission the create, update and delete actions check.
  const canWrite = userCan(actorAccess, "suppliers:write");
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
          <Link
            href={`/suppliers/categories/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {row.original.name}
          </Link>
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
        cell: ({ row }) =>
          canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Acciones" variant="ghost">
                  <MoreHorizontal className="size-4" />
                </IconButton>
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
    [canWrite],
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
          {canWrite && (
            <Button onClick={() => setDialogState({ mode: "create" })}>
              <Plus />
              Nueva categoría
            </Button>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={categories}
        getRowId={(cat) => cat.id}
        emptyMessage="Sin categorías. Creá la primera para empezar a clasificar proveedores."
      />

      {canWrite && (
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
      )}

      <AlertDialog
        open={canWrite && confirmDelete !== null}
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
