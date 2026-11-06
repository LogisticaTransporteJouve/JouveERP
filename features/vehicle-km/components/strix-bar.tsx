"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { DisabledHint } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { syncPhase } from "@/lib/afip/arca-sync-run";
import { todayIsoLocal } from "@/lib/date-range";
import { strixStatusText } from "@/lib/strix/sync-text";

import { useRequestStrixSync, useStrixStatus } from "../hooks/use-vehicle-km";

/** «Traer km» for the dates the person picks (the range on screen by
 *  default). */
function FetchKmDialog({
  initialFrom,
  initialTo,
  open,
  onOpenChange,
}: {
  initialFrom: string;
  initialTo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const request = useRequestStrixSync();
  const today = todayIsoLocal();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo > today ? today : initialTo);
  const invalid = !from || !to || from > to;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    request.mutate(
      { from, to },
      {
        onSuccess: () => {
          toast.success("Pedido a Strix enviado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Traer km de Strix</DialogTitle>
            <DialogDescription>
              Trae los km de todos los vehículos entre esas fechas. Los días que
              ya estaban se actualizan.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="strix-from">Desde</Label>
              <DatePicker
                id="strix-from"
                value={from}
                max={to || today}
                onChange={setFrom}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strix-to">Hasta</Label>
              <DatePicker
                id="strix-to"
                value={to}
                min={from}
                max={today}
                onChange={setTo}
              />
            </div>
          </div>
          {from > to && (
            <p className="text-sm text-muted-foreground">
              La fecha desde no puede ser posterior a la fecha hasta.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <DisabledHint
              reason={invalid ? "Completá un rango de fechas válido." : null}
            >
              <Button type="submit" disabled={invalid || request.isPending}>
                Traer km
              </Button>
            </DisabledHint>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The Strix sync's state, with «Traer km» for every vehicle at once. The
 *  Strix user itself is set in Admin → Accesos. */
export function StrixBar({
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
        {canAdmin && s && s.state !== "ok" && (
          <>
            {" "}
            <Link
              href="/admin/accesos"
              className="underline underline-offset-2"
            >
              Ir a Admin → Accesos
            </Link>
          </>
        )}
      </p>
      {canWrite && (
        <DisabledHint
          reason={s && s.state !== "ok" ? strixStatusText(s, Date.now()) : null}
        >
          <Button
            size="sm"
            disabled={!s || s.state !== "ok" || busy}
            onClick={() => setOpen(true)}
          >
            <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
            Traer km
          </Button>
        </DisabledHint>
      )}
      {open && (
        <FetchKmDialog
          initialFrom={from}
          initialTo={to}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}
