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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useDeleteFuelLoad, useFuelLoads } from "../hooks/use-fuel";
import type { FuelLoad } from "../schema";

import { FuelDialog } from "./fuel-dialog";

function formatMoney(n: number) {
  return `$${n.toLocaleString("es-AR")}`;
}

export function FuelTable({
  vehicleOptions,
  tripOptions,
}: {
  vehicleOptions: { id: string; patente: string }[];
  tripOptions: {
    id: string;
    trip_date: string;
    origin: string | null;
    destination: string | null;
  }[];
}) {
  const { data: items } = useFuelLoads();
  const deleteMut = useDeleteFuelLoad();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; fuelLoad: FuelLoad } | null
  >(null);

  async function handleDelete(f: FuelLoad) {
    const ok = await confirm({
      title: `Borrar carga del ${f.load_date}`,
      description: "Esta acción no se puede deshacer.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(f.id, {
      onSuccess: () => toast.success("Carga borrada."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Cargas de combustible
          </h1>
          <p className="text-muted-foreground text-sm">
            Cargas de combustible de la flota por vehículo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPdfButton resource="fuel" label="Exportar PDF" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nueva carga
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Fecha</TableHead>
              <TableHead className="w-32">Vehículo</TableHead>
              <TableHead className="w-32">Litros</TableHead>
              <TableHead className="w-36">Importe</TableHead>
              <TableHead>Estación</TableHead>
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
                  Sin cargas. Agregá la primera.
                </TableCell>
              </TableRow>
            ) : (
              items.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.load_date}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {f.vehicle?.patente ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {f.liters.toLocaleString("es-AR")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatMoney(f.amount)}
                  </TableCell>
                  <TableCell className="text-sm">{f.station ?? "—"}</TableCell>
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
                            setDialog({ mode: "edit", fuelLoad: f })
                          }
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(f)}
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
        <FuelDialog
          mode={dialog.mode}
          fuelLoad={dialog.mode === "edit" ? dialog.fuelLoad : undefined}
          vehicleOptions={vehicleOptions}
          tripOptions={tripOptions}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
