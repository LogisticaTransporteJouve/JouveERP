"use client";

import { KeyRound, RefreshCw } from "lucide-react";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { PeriodFilter } from "@/components/period-filter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { syncPhase } from "@/lib/afip/arca-sync-run";
import { formatArgentineDate, formatInteger } from "@/lib/format";
import { resolvePeriod, type PeriodSelection } from "@/lib/list-period";
import { strixStatusText } from "@/lib/strix/sync-text";

import {
  useRequestStrixSync,
  useStrixStatus,
  useVehicleKmRange,
} from "../hooks/use-vehicle-km";
import { kmPeriod } from "../lib/km-period";
import type { VehicleKmRow } from "../schema";

import { StrixAccountDialog } from "./strix-account-dialog";
import { VehicleKmDaysDialog } from "./vehicle-km-days-dialog";

function KmRangeTable({
  from,
  to,
  onOpen,
}: {
  from: string;
  to: string;
  onOpen: (row: VehicleKmRow) => void;
}) {
  const { data } = useVehicleKmRange(from, to);
  if (data.rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No hay vehículos activos que lleven km.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vehículo</TableHead>
            <TableHead className="text-right">Km recorridos</TableHead>
            <TableHead className="text-right">Días con km</TableHead>
            <TableHead className="text-right">Último día</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row) => (
            <TableRow
              key={row.vehicle_id}
              className="cursor-pointer"
              onClick={() => onOpen(row)}
            >
              <TableCell>
                <button
                  type="button"
                  className="font-mono text-xs underline-offset-4 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(row);
                  }}
                >
                  {row.patente}
                </button>
                {row.alias && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    {row.alias}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatInteger(row.km)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.days}
              </TableCell>
              <TableCell className="text-right text-sm">
                {row.last_day ? formatArgentineDate(row.last_day) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatInteger(data.total)}
            </TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function StrixBar({
  from,
  to,
  canWrite,
  canAdmin,
}: {
  from: string;
  to: string;
  canWrite: boolean;
  canAdmin: boolean;
}) {
  const status = useStrixStatus();
  const request = useRequestStrixSync();
  const [open, setOpen] = useState(false);
  const s = status.data;
  const busy =
    !!s &&
    ["waiting", "running"].includes(
      syncPhase({ ...s.sync, result: null }, Date.now()),
    );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <p className="text-muted-foreground text-sm">
        {status.isError
          ? status.error.message
          : s
            ? strixStatusText(s, Date.now())
            : "Leyendo Strix…"}
      </p>
      <div className="flex gap-2">
        {canAdmin && s && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <KeyRound className="size-4" />
            Usuario de Strix
          </Button>
        )}
        {canWrite && (
          <Button
            size="sm"
            disabled={!s || s.state !== "ok" || busy || request.isPending}
            onClick={() =>
              request.mutate(
                { from, to },
                {
                  onSuccess: () => toast.success("Pedido a Strix enviado."),
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
            Traer de Strix
          </Button>
        )}
      </div>
      {open && s && (
        <StrixAccountDialog status={s} open={open} onOpenChange={setOpen} />
      )}
    </div>
  );
}

export function VehicleKmView({
  canWrite,
  canAdmin,
}: {
  canWrite: boolean;
  canAdmin: boolean;
}) {
  const [selection, setSelection] = useState<PeriodSelection>({
    preset: "this_month",
    from: null,
    to: null,
  });
  const range = kmPeriod(resolvePeriod(selection));
  const [opened, setOpened] = useState<VehicleKmRow | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Km recorridos
          </h1>
          <p className="text-muted-foreground text-sm">
            Los km de cada vehículo según Strix (GPS), por día. Se traen solos
            todos los días; hacé clic en una patente para ver el detalle.
          </p>
        </div>
        <PeriodFilter value={selection} onChange={setSelection} />
      </div>
      <StrixBar
        from={range.from}
        to={range.to}
        canWrite={canWrite}
        canAdmin={canAdmin}
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <KmRangeTable from={range.from} to={range.to} onOpen={setOpened} />
      </Suspense>
      {opened && (
        <VehicleKmDaysDialog
          vehicle={{ id: opened.vehicle_id, patente: opened.patente }}
          initial={selection}
          onOpenChange={(o) => {
            if (!o) setOpened(null);
          }}
        />
      )}
    </div>
  );
}
