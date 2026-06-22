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
  useDeleteDriver,
  useDrivers,
  useSetDriverActive,
} from "../hooks/use-drivers";
import type { Driver } from "../schema";

import { DriverDialog } from "./driver-dialog";

export function DriversTable() {
  const { data: items } = useDrivers();
  const deleteMut = useDeleteDriver();
  const toggleMut = useSetDriverActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; driver: Driver } | null
  >(null);

  async function handleDelete(d: Driver) {
    const ok = await confirm({
      title: `Borrar ${d.full_name}`,
      description: "Si tiene viajes, quedan sin chofer asignado.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(d.id, {
      onSuccess: () => toast.success("Chofer borrado."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Choferes</h1>
          <p className="text-muted-foreground text-sm">
            Choferes propios y contratados de la flota.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nuevo chofer
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-40">CUIT</TableHead>
              <TableHead className="w-32">Licencia</TableHead>
              <TableHead className="w-36">Teléfono</TableHead>
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
                  Sin choferes. Agregá el primero.
                </TableCell>
              </TableRow>
            ) : (
              items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {d.cuit ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {d.license_number ?? "—"}
                    {d.license_category ? ` (${d.license_category})` : ""}
                  </TableCell>
                  <TableCell className="text-sm">{d.phone ?? "—"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={d.is_active}
                      onCheckedChange={(v) =>
                        toggleMut.mutate(
                          { id: d.id, is_active: v },
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
                          onClick={() => setDialog({ mode: "edit", driver: d })}
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(d)}
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
        <DriverDialog
          mode={dialog.mode}
          driver={dialog.mode === "edit" ? dialog.driver : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
