"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  lastBilledEnd,
  overlapsBilled,
  suggestedStart,
  uncoveredGap,
} from "../lib/continuity";
import {
  useEnabledPos,
  useInvoiceStorage,
  useInvoicingChannels,
  useStorageBilling,
} from "../hooks/use-storage-billing";
import { type StorageBillingRun } from "../schema";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const fmt = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export function StorageInvoiceDialog({
  client,
  reportStart,
  reportEnd,
  runs,
  onClose,
}: {
  client: { client_id: string; client_name: string } | null;
  reportStart: string;
  reportEnd: string;
  runs: StorageBillingRun[];
  onClose: () => void;
}) {
  const open = client !== null;
  const clientRuns = client
    ? runs.filter((r) => r.client_id === client.client_id)
    : [];
  const lastEnd = lastBilledEnd(clientRuns);

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [channelId, setChannelId] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("");

  const { data: channels } = useInvoicingChannels();
  const { data: posList } = useEnabledPos(channelId);
  const invoiceMut = useInvoiceStorage();

  // Live preview for [start, end] (recomputed server-side on emit).
  const { data: billing, isFetching } = useStorageBilling(start, end);
  const clientLines = client
    ? (billing?.lines ?? []).filter((l) => l.client_id === client.client_id)
    : [];
  const almacenaje = clientLines.reduce((s, l) => s + l.storage_charge, 0);
  const carga = clientLines.reduce((s, l) => s + l.handling_in_charge, 0);
  const descarga = clientLines.reduce((s, l) => s + l.handling_out_charge, 0);
  const total = almacenaje + carga + descarga;

  useEffect(() => {
    if (open) {
      setStart(suggestedStart(clientRuns) ?? reportStart);
      setEnd(reportEnd);
      setChannelId("");
      setPuntoVenta("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.client_id, reportStart, reportEnd]);

  const gap = start ? uncoveredGap(clientRuns, start) : null;
  const overlaps = start && end ? overlapsBilled(clientRuns, start, end) : false;
  const validRange = Boolean(start) && Boolean(end) && end >= start;

  function onSubmit() {
    if (!client) return;
    if (!channelId) {
      toast.error("Elegí un canal.");
      return;
    }
    if (!puntoVenta) {
      toast.error("Elegí un punto de venta.");
      return;
    }
    invoiceMut.mutate(
      {
        client_id: client.client_id,
        period_start: start,
        period_end: end,
        channel_id: channelId,
        punto_venta: Number(puntoVenta),
      },
      {
        onSuccess: () => {
          toast.success("Factura de almacenaje emitida.");
          onClose();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Facturar almacenaje</DialogTitle>
          <DialogDescription>
            {client?.client_name}
            {" — "}
            {lastEnd
              ? `facturado hasta ${fmt(lastEnd)}`
              : "sin facturas previas"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="storage-start">Desde</Label>
              <Input
                id="storage-start"
                type="date"
                value={start}
                max={end}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="storage-end">Hasta</Label>
              <Input
                id="storage-end"
                type="date"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          {gap && (
            <p className="flex items-start gap-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              <AlertTriangle className="size-4 shrink-0" />
              Te falta facturar del {fmt(gap.from)} al {fmt(gap.to)}. Si es a
              propósito, seguí; sino arrancá el desde en {fmt(gap.from)}.
            </p>
          )}
          {overlaps && (
            <p className="flex items-start gap-2 rounded-md border border-dashed p-2 text-xs text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              Ese período ya fue facturado (total o parcialmente) para este
              cliente.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="storage-channel">Canal</Label>
            <Select
              value={channelId}
              onValueChange={(v) => {
                setChannelId(v);
                setPuntoVenta("");
              }}
            >
              <SelectTrigger id="storage-channel">
                <SelectValue placeholder="Elegí un canal" />
              </SelectTrigger>
              <SelectContent>
                {(channels ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.is_fiscal ? " (fiscal)" : " (interna)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="storage-pos">Punto de venta</Label>
            <Select
              value={puntoVenta}
              onValueChange={setPuntoVenta}
              disabled={!channelId}
            >
              <SelectTrigger id="storage-pos">
                <SelectValue placeholder="Elegí un punto de venta" />
              </SelectTrigger>
              <SelectContent>
                {(posList ?? []).map((p) => (
                  <SelectItem key={p.numero} value={String(p.numero)}>
                    {String(p.numero).padStart(5, "0")}
                    {p.nickname ? ` — ${p.nickname}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
            <Row label="Almacenaje" value={money(almacenaje)} />
            <Row label="Carga" value={money(carga)} />
            <Row label="Descarga" value={money(descarga)} />
            <div className="mt-1 flex items-center justify-between border-t pt-1 font-medium">
              <span>Total</span>
              <span className="font-mono">{money(total)}</span>
            </div>
            {isFetching && (
              <p className="text-muted-foreground text-xs">Calculando…</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={
              invoiceMut.isPending ||
              !validRange ||
              overlaps ||
              total <= 0 ||
              !channelId ||
              !puntoVenta
            }
          >
            Emitir factura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
