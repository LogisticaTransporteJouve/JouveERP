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
  useDeleteWarehouse,
  useSetWarehouseActive,
  useWarehouses,
} from "../hooks/use-warehouses";
import type { Warehouse } from "../schema";

import { WarehouseDialog } from "./warehouse-dialog";

export function WarehousesTable() {
  const { data: items } = useWarehouses();
  const deleteMut = useDeleteWarehouse();
  const toggleMut = useSetWarehouseActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; warehouse: Warehouse } | null
  >(null);

  async function handleDelete(w: Warehouse) {
    const ok = await confirm({
      title: `Borrar ${w.name}`,
      description: "Esta acción no se puede deshacer.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(w.id, {
      onSuccess: () => toast.success("Depósito borrado."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Depósitos</h1>
          <p className="text-muted-foreground text-sm">
            Depósitos físicos para almacenamiento de mercadería.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nuevo depósito
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Dirección</TableHead>
              <TableHead className="w-40">Capacidad (pallets)</TableHead>
              <TableHead className="w-20">Activo</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  Sin depósitos. Agregá el primero.
                </TableCell>
              </TableRow>
            ) : (
              items.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell className="text-sm">{w.address ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {w.capacity_pallets ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={w.is_active}
                      onCheckedChange={(v) =>
                        toggleMut.mutate(
                          { id: w.id, is_active: v },
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
                            setDialog({ mode: "edit", warehouse: w })
                          }
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(w)}
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
        <WarehouseDialog
          mode={dialog.mode}
          warehouse={dialog.mode === "edit" ? dialog.warehouse : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
