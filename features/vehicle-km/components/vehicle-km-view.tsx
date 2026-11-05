"use client";

import { AlertTriangle, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MonthPicker } from "@/components/ui/month-picker";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate, formatInteger, formatPeriod } from "@/lib/format";

import { useDeleteKmReading, useVehicleKmMonth } from "../hooks/use-vehicle-km";
import type { VehicleKmRow } from "../schema";

import { KmReadingDialog } from "./km-reading-dialog";

function KmMonthTable({
  period,
  canWrite,
}: {
  period: string;
  canWrite: boolean;
}) {
  const { data } = useVehicleKmMonth(period);
  const deleteMut = useDeleteKmReading();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<VehicleKmRow | null>(null);

  async function handleDelete(row: VehicleKmRow) {
    if (!row.reading) return;
    const ok = await confirm({
      title: `Borrar el km de ${row.patente}`,
      description: `Se borra la lectura de ${formatPeriod(period)}.`,
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(row.reading.id, {
      onSuccess: () => toast.success("Lectura borrada."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <>
      <p className="text-muted-foreground text-sm">
        {data.rows.length === 0
          ? "No hay vehículos activos que lleven km."
          : data.missing === 0
            ? `Están cargados los km de los ${data.rows.length} vehículos.`
            : `Faltan ${data.missing} de ${data.rows.length} vehículos.`}
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehículo</TableHead>
              <TableHead className="text-right">Lectura anterior</TableHead>
              <TableHead className="text-right">Km del mes</TableHead>
              <TableHead className="text-right">Recorrido</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.vehicle_id}>
                <TableCell>
                  <span className="font-mono text-xs">{row.patente}</span>
                  {row.alias && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {row.alias}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {row.previous ? (
                    <>
                      {formatInteger(row.previous.km)}
                      <span className="text-muted-foreground ml-1 text-xs">
                        ({formatPeriod(row.previous.period)})
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {row.reading ? (
                    <>
                      {formatInteger(row.reading.km)}
                      <span className="text-muted-foreground ml-1 text-xs">
                        {formatArgentineDate(row.reading.read_on)}
                      </span>
                    </>
                  ) : canWrite ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(row)}
                    >
                      Cargar
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">Sin cargar</span>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {row.driven === null ? (
                    "—"
                  ) : row.driven < 0 ? (
                    <span
                      className="inline-flex items-center gap-1 font-medium"
                      title="El km bajó respecto de la lectura anterior."
                    >
                      <AlertTriangle className="size-4" />
                      {formatInteger(row.driven)} (bajó)
                    </span>
                  ) : (
                    formatInteger(row.driven)
                  )}
                </TableCell>
                <TableCell>
                  {canWrite && row.reading && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Acciones de ${row.patente}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(row)}>
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(row)}
                        >
                          <Trash2 className="size-4" />
                          Borrar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <KmReadingDialog
        period={period}
        row={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </>
  );
}

export function VehicleKmView({
  initialPeriod,
  canWrite,
}: {
  initialPeriod: string;
  canWrite: boolean;
}) {
  const [period, setPeriod] = useState(initialPeriod);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Km mensual</h1>
          <p className="text-muted-foreground text-sm">
            El km del odómetro de cada vehículo, una vez por mes. Tareas lo
            recuerda el día 1 y avisa el día 5 si falta.
          </p>
        </div>
        <MonthPicker
          aria-label="Mes"
          className="w-44"
          value={period}
          max={initialPeriod}
          onChange={(value) => {
            if (/^\d{4}-\d{2}$/.test(value)) {
              setPeriod(value);
            }
          }}
        />
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <KmMonthTable period={period} canWrite={canWrite} />
      </Suspense>
    </div>
  );
}
