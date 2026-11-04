"use client";

import { CloudDownload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatArgentineDate, formatArgentineDateTime } from "@/lib/format";

import type { ArcaSyncStatus } from "../actions/arca-received-sync-actions";
import {
  useArcaSyncStatus,
  useRequestArcaSync,
} from "../hooks/use-arca-received";

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function statusText(s: ArcaSyncStatus): string {
  switch (s.state) {
    case "missing":
      return "Falta el usuario de ARCA: lo carga un owner o admin en Admin → AFIP → Puntos de venta.";
    case "rejected":
      return "ARCA rechazó la clave guardada: un owner o admin tiene que actualizarla en Admin → AFIP → Puntos de venta.";
    case "ok":
      return s.lastSuccessAt
        ? `Se trae solo todos los días (últimos 60 días) · último acceso ${formatArgentineDateTime(s.lastSuccessAt)}`
        : "Se trae solo todos los días (últimos 60 días) · todavía no se usó";
  }
}

function SyncDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const month = currentMonth();
  const [fromMonth, setFromMonth] = useState(month);
  const [toMonth, setToMonth] = useState(month);
  const request = useRequestArcaSync();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Traer de ARCA</DialogTitle>
          <DialogDescription>
            Trae los comprobantes recibidos de los meses que elijas (hasta 12).
            Lo que ya está en la bandeja no se duplica.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="arca-sync-from">Desde</Label>
            <Input
              id="arca-sync-from"
              type="month"
              value={fromMonth}
              max={month}
              onChange={(e) => setFromMonth(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="arca-sync-to">Hasta</Label>
            <Input
              id="arca-sync-to"
              type="month"
              value={toMonth}
              max={month}
              onChange={(e) => setToMonth(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={request.isPending}
          >
            Cancelar
          </Button>
          <Button
            disabled={request.isPending}
            onClick={() =>
              request.mutate(
                { fromMonth, toMonth },
                {
                  onSuccess: (r) => {
                    toast.success(
                      `Pedido a ARCA del ${formatArgentineDate(r.from)} al ${formatArgentineDate(r.to)}. En unos minutos aparecen en Pendientes.`,
                    );
                    onOpenChange(false);
                  },
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            {request.isPending ? "Pidiendo…" : "Traer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** «Traer de ARCA»: the state of the stored ARCA user and the button that
 *  queues a run for chosen months. */
export function ArcaSyncCard() {
  const status = useArcaSyncStatus();
  const [open, setOpen] = useState(false);
  const ready = status.data?.state === "ok";

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">Traer de ARCA</p>
        <p className="text-muted-foreground text-sm">
          {status.isPending
            ? "Revisando el usuario de ARCA…"
            : status.isError
              ? status.error.message
              : statusText(status.data)}
        </p>
      </div>
      <Button
        size="sm"
        className="shrink-0"
        disabled={!ready}
        onClick={() => setOpen(true)}
      >
        <CloudDownload aria-hidden />
        Traer de ARCA
      </Button>
      {open ? <SyncDialog open={open} onOpenChange={setOpen} /> : null}
    </div>
  );
}
