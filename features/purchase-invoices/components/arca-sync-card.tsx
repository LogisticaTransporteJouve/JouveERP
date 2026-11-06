"use client";

import { CloudDownload, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { MonthPicker } from "@/components/ui/month-picker";
import { Label } from "@/components/ui/label";
import { arcaErrorText } from "@/lib/afip/arca-error-text";
import { formatArgentineDate, formatArgentineDateTime } from "@/lib/format";

import type { ArcaSyncStatus } from "../actions/arca-received-sync-actions";
import { isSyncPeriodOld } from "../lib/arca-sync-period";
import {
  useArcaSyncStatus,
  useInvalidateTray,
  useRequestArcaSync,
} from "../hooks/use-arca-received";
import {
  syncPhase,
  syncResultText,
  type SyncPhase,
} from "@/lib/afip/arca-sync-run";

function todayInArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

function statusText(s: ArcaSyncStatus, phase: SyncPhase): string {
  if (s.state === "missing") {
    return "Falta el usuario de ARCA: lo carga un owner o admin en Admin → AFIP → Puntos de venta.";
  }
  if (phase === "waiting") return "Pedido enviado: esperando que arranque…";
  if (phase === "running") return "Trayendo de ARCA…";
  if (phase === "not_started") {
    return "El último pedido no arrancó. Probá de nuevo; si se repite, avisale a un owner o admin.";
  }
  if (phase === "died") {
    return "La última corrida se cortó sin terminar. Probá de nuevo; si se repite, avisale a un owner o admin.";
  }
  if (s.state === "rejected") {
    return s.lastErrorCode === "SIGN_IN_REJECTED"
      ? "ARCA rechazó la clave guardada: un owner o admin tiene que actualizarla en Admin → AFIP → Puntos de venta."
      : `JouveERP dejó de entrar a ARCA tras dos ingresos fallidos (${arcaErrorText(s.lastErrorCode ?? "SIGN_IN_FAILED")}). Un owner o admin vuelve a cargar la clave en Admin → AFIP → Puntos de venta.`;
  }
  const last = s.sync.finishedAt
    ? `Última vez ${formatArgentineDateTime(s.sync.finishedAt)}${s.sync.result ? `: ${syncResultText(s.sync.result)}` : "."}`
    : "Todavía no se trajo nada.";
  return `Se trae solo todos los días (últimos 60 días). ${last}`;
}

function SyncDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const today = todayInArgentina();
  const month = today.slice(0, 7);
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="arca-sync-from">Desde</Label>
            <MonthPicker
              id="arca-sync-from"
              value={fromMonth}
              max={month}
              onChange={setFromMonth}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="arca-sync-to">Hasta</Label>
            <MonthPicker
              id="arca-sync-to"
              value={toMonth}
              max={month}
              onChange={setToMonth}
            />
          </div>
        </div>
        {isSyncPeriodOld(fromMonth, today) && (
          <p className="text-sm text-muted-foreground">
            El período empieza hace más de un año: revisá que el año sea el que
            querés.
          </p>
        )}
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
                      `Pedido a ARCA del ${formatArgentineDate(r.from)} al ${formatArgentineDate(r.to)}. Te aviso acá cuando termine.`,
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

/** «Traer de ARCA»: the stored ARCA user's state, the last run and the
 *  button that queues one for chosen months. Follows a pending run and
 *  refreshes the tray when it ends. */
export function ArcaSyncCard({
  unreadable = 0,
  onShowUnreadable,
}: {
  /** Vouchers in the tray whose amounts did not read. */
  unreadable?: number;
  onShowUnreadable?: () => void;
} = {}) {
  const status = useArcaSyncStatus();
  const invalidateTray = useInvalidateTray();
  const [open, setOpen] = useState(false);
  // Measured at the last fetch: a poll re-renders even when the data is the
  // same, so a request that never starts turns into «no arrancó».
  const phase = status.data
    ? syncPhase(status.data.sync, status.dataUpdatedAt)
    : "idle";
  const pending = phase === "waiting" || phase === "running";

  // A run seen pending that is now done: refresh the tray and say how it went.
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current || !status.data) return;
    wasPending.current = false;
    void invalidateTray();
    const result = status.data.sync.result;
    if (phase === "not_started") {
      toast.error("El pedido a ARCA no arrancó. Probá de nuevo.");
    } else if (phase === "died") {
      toast.error("La corrida de ARCA se cortó sin terminar. Probá de nuevo.");
    } else if (result?.outcome === "done") {
      toast.success(`ARCA: ${syncResultText(result)}`);
    } else if (result) {
      toast.error(syncResultText(result));
    }
  }, [pending, phase, status.data, invalidateTray]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">Traer de ARCA</p>
        <p className="text-muted-foreground text-sm">
          {status.isPending
            ? "Revisando el usuario de ARCA…"
            : status.isError
              ? status.error.message
              : statusText(status.data, phase)}
        </p>
        {unreadable > 0 && onShowUnreadable && (
          <button
            type="button"
            className="text-sm underline underline-offset-2"
            onClick={onShowUnreadable}
          >
            {unreadable === 1
              ? "Ver el comprobante que no se pudo leer"
              : `Ver los ${unreadable} comprobantes que no se pudieron leer`}
          </button>
        )}
      </div>
      <Button
        size="sm"
        className="shrink-0"
        disabled={status.data?.state !== "ok" || pending}
        onClick={() => setOpen(true)}
      >
        {pending ? (
          <Loader2 aria-hidden className="animate-spin" />
        ) : (
          <CloudDownload aria-hidden />
        )}
        {pending ? "Trayendo…" : "Traer de ARCA"}
      </Button>
      {open ? <SyncDialog open={open} onOpenChange={setOpen} /> : null}
    </div>
  );
}
