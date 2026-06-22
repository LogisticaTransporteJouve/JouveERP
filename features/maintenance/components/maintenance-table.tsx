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

import { useDeleteMaintenance, useMaintenance } from "../hooks/use-maintenance";
import { MAINTENANCE_KIND_LABELS, type MaintenanceRecord } from "../schema";

import { MaintenanceDialog } from "./maintenance-dialog";

function formatMoney(n: number | null) {
  if (n === null) return "—";
  return `$${n.toLocaleString("es-AR")}`;
}

export function MaintenanceTable({
  vehicleOptions,
}: {
  vehicleOptions: { id: string; patente: string }[];
}) {
  const { data: items } = useMaintenance();
  const deleteMut = useDeleteMaintenance();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; record: MaintenanceRecord }
    | null
  >(null);

  async function handleDelete(r: MaintenanceRecord) {
    const ok = await confirm({
      title: `Borrar mantenimiento del ${r.service_date}`,
      description: "Esta acción no se puede deshacer.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(r.id, {
      onSuccess: () => toast.success("Mantenimiento borrado."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Mantenimientos
          </h1>
          <p className="text-muted-foreground text-sm">
            Mantenimientos de la flota: service, reparaciones y próximos
            vencimientos.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nuevo mantenimiento
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Fecha</TableHead>
              <TableHead className="w-32">Vehículo</TableHead>
              <TableHead className="w-32">Tipo</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-32">Costo</TableHead>
              <TableHead className="w-32">Próx. service</TableHead>
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
                  Sin mantenimientos. Agregá el primero.
                </TableCell>
              </TableRow>
            ) : (
              items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.service_date}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.vehicle?.patente ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {MAINTENANCE_KIND_LABELS[r.kind]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{r.description}</TableCell>
                  <TableCell className="text-sm">
                    {formatMoney(r.cost)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.next_service_date ?? "—"}
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
                            setDialog({ mode: "edit", record: r })
                          }
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(r)}
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
        <MaintenanceDialog
          mode={dialog.mode}
          record={dialog.mode === "edit" ? dialog.record : undefined}
          vehicleOptions={vehicleOptions}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
