"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
    | { mode: "create" }
    | { mode: "edit"; category: SupplierCategory }
    | null
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
        <Button onClick={() => setDialogState({ mode: "create" })}>
          <Plus />
          Nueva categoría
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead className="w-24">Estado</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                  Sin categorías. Creá la primera para empezar a clasificar
                  proveedores.
                </TableCell>
              </TableRow>
            ) : (
              categories.map((cat) => (
                <TableRow key={cat.id}>
                  <TableCell className="font-medium">{cat.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {cat.slug}
                  </TableCell>
                  <TableCell>
                    {cat.is_active ? (
                      <Badge variant="secondary">Activa</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Inactiva
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Acciones">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            setDialogState({ mode: "edit", category: cat })
                          }
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setConfirmDelete(cat)}
                          variant="destructive"
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

      <SupplierCategoryDialog
        mode={dialogState?.mode ?? "create"}
        category={dialogState?.mode === "edit" ? dialogState.category : undefined}
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
              proveedores asignados a esta categoría, el sistema te va a
              avisar para que los reasignes antes.
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
