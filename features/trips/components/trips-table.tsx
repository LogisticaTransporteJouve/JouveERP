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

import { useDeleteTrip, useTrips } from "../hooks/use-trips";
import { TRIP_STATUS_LABELS, type Trip } from "../schema";

import { TripDialog } from "./trip-dialog";

function formatMoney(n: number | null) {
  if (n === null) return "—";
  return `$${n.toLocaleString("es-AR")}`;
}

export function TripsTable({
  driverOptions,
  vehicleOptions,
}: {
  driverOptions: { id: string; full_name: string }[];
  vehicleOptions: { id: string; patente: string }[];
}) {
  const { data: items } = useTrips();
  const deleteMut = useDeleteTrip();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; trip: Trip } | null
  >(null);

  async function handleDelete(t: Trip) {
    const ok = await confirm({
      title: `Borrar viaje del ${t.trip_date}`,
      description: "Esta acción no se puede deshacer.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(t.id, {
      onSuccess: () => toast.success("Viaje borrado."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Viajes</h1>
          <p className="text-muted-foreground text-sm">
            Viajes de la flota con chofer, vehículo y resultado.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus />
          Nuevo viaje
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Fecha</TableHead>
              <TableHead>Chofer</TableHead>
              <TableHead className="w-32">Vehículo</TableHead>
              <TableHead>Origen → Destino</TableHead>
              <TableHead className="w-32">Estado</TableHead>
              <TableHead className="w-32">Ingreso</TableHead>
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
                  Sin viajes. Agregá el primero.
                </TableCell>
              </TableRow>
            ) : (
              items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.trip_date}</TableCell>
                  <TableCell className="text-sm">
                    {t.driver?.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.vehicle?.patente ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t.origin ?? "—"} → {t.destination ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {TRIP_STATUS_LABELS[t.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatMoney(t.revenue)}
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
                          onClick={() => setDialog({ mode: "edit", trip: t })}
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(t)}
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
        <TripDialog
          mode={dialog.mode}
          trip={dialog.mode === "edit" ? dialog.trip : undefined}
          driverOptions={driverOptions}
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
