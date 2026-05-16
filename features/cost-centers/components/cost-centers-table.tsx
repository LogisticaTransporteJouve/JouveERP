"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
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
  useCostCenters,
  useDeleteCostCenter,
} from "../hooks/use-cost-centers";
import type { CostCenter } from "../schema";

import { CostCenterDialog } from "./cost-center-dialog";

export function CostCentersTable() {
  const { data: items } = useCostCenters();
  const deleteMut = useDeleteCostCenter();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; costCenter: CostCenter } | null
  >(null);

  async function handleDelete(cc: CostCenter) {
    const ok = await confirm({
      title: `Borrar ${cc.code}`,
      description: "Si está en uso por algún movimiento, va a fallar.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(cc.id, {
      onSuccess: () => toast.success("Centro borrado."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Centros de costo
          </h1>
          <p className="text-sm text-muted-foreground">
            Dimensión opcional para clasificar movimientos y reportar EERR por
            flota / proyecto / obra.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nuevo centro
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-24">Estado</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Sin centros de costo.
                </TableCell>
              </TableRow>
            ) : (
              items.map((cc) => (
                <TableRow key={cc.id}>
                  <TableCell className="font-mono text-xs">{cc.code}</TableCell>
                  <TableCell className="font-medium">{cc.name}</TableCell>
                  <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                    {cc.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    {cc.is_active ? (
                      <Badge variant="outline">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
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
                          onClick={() => setDialog({ mode: "edit", costCenter: cc })}
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(cc)}
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
        <CostCenterDialog
          mode={dialog.mode}
          costCenter={dialog.mode === "edit" ? dialog.costCenter : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
