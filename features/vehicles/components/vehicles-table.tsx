"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ExportPdfButton } from "@/components/export-pdf-button";
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
  useDeleteVehicle,
  useSetVehicleActive,
  useVehicles,
} from "../hooks/use-vehicles";
import { VEHICLE_TYPE_LABELS, type Vehicle } from "../schema";

import { VehicleDialog } from "./vehicle-dialog";

export function VehiclesTable() {
  const { data: items } = useVehicles();
  const deleteMut = useDeleteVehicle();
  const toggleMut = useSetVehicleActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; vehicle: Vehicle } | null
  >(null);

  async function handleDelete(v: Vehicle) {
    const ok = await confirm({
      title: `Borrar ${v.patente}`,
      description: "Si tiene viajes, quedan sin vehículo asignado.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(v.id, {
      onSuccess: () => toast.success("Vehículo borrado."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehículos</h1>
          <p className="text-muted-foreground text-sm">
            Vehículos de la flota.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPdfButton resource="vehicles" label="Exportar PDF" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nuevo vehículo
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patente</TableHead>
              <TableHead className="w-40">Alias</TableHead>
              <TableHead className="w-32">Tipo</TableHead>
              <TableHead className="w-40">Marca/Modelo</TableHead>
              <TableHead className="w-20">Año</TableHead>
              <TableHead className="w-20">Activo</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  Sin vehículos. Agregá el primero.
                </TableCell>
              </TableRow>
            ) : (
              items.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono font-medium">
                    {v.patente}
                  </TableCell>
                  <TableCell className="text-sm">{v.alias ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {VEHICLE_TYPE_LABELS[v.vehicle_type]}
                  </TableCell>
                  <TableCell className="text-sm">
                    {v.brand ?? "—"}
                    {v.model ? ` ${v.model}` : ""}
                  </TableCell>
                  <TableCell className="text-sm">{v.year ?? "—"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={v.is_active}
                      onCheckedChange={(checked) =>
                        toggleMut.mutate(
                          { id: v.id, is_active: checked },
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
                            setDialog({ mode: "edit", vehicle: v })
                          }
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(v)}
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
        <VehicleDialog
          mode={dialog.mode}
          vehicle={dialog.mode === "edit" ? dialog.vehicle : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
