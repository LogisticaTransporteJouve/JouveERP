"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ReadError } from "@/components/read-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  billedRuns,
  lastBilledEnd,
  overlapsBilled,
  pendingRuns,
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
  client: {
    client_id: string;
    client_name: string;
    client_is_fiscal: boolean | null;
  } | null;
  reportStart: string;
  reportEnd: string;
  runs: StorageBillingRun[];
  onClose: () => void;
}) {
  const open = client !== null;
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [channelId, setChannelId] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("");

  // Billed = linked to an invoice, as the claim decides it; a pending claim
  // is left to the server (it refuses a fresh one and relinks or frees a
  // stale one). Continuity looks at every channel, the overlap at the
  // chosen one.
  const clientRuns = client ? billedRuns(runs, client.client_id, null) : [];
  const channelRuns = client
    ? billedRuns(runs, client.client_id, channelId || null)
    : [];
  const clientPending = client
    ? pendingRuns(runs, client.client_id, channelId || null)
    : [];
  const lastEnd = lastBilledEnd(clientRuns);

  const channelsQuery = useInvoicingChannels();
  const channels = channelsQuery.data;
  // A Ventas client is invoiced on a fiscal channel and an Otras ventas one
  // on an internal channel (issueFiscalInvoiceAction refuses the other).
  const sideChannels = (channels ?? []).filter(
    (c) =>
      client?.client_is_fiscal == null ||
      c.is_fiscal === client.client_is_fiscal,
  );
  const posQuery = useEnabledPos(channelId);
  const posList = posQuery.data;
  const invoiceMut = useInvoiceStorage();

  // Live preview for [start, end] (recomputed server-side on emit).
  const {
    data: billing,
    isFetching,
    isError: previewFailed,
    refetch: refetchPreview,
  } = useStorageBilling(start, end);
  const previewMissing = previewFailed && !billing;
  const clientLines = client
    ? (billing?.lines ?? []).filter((l) => l.client_id === client.client_id)
    : [];
  const storage = clientLines.reduce((s, l) => s + l.storage_charge, 0);
  const loading = clientLines.reduce((s, l) => s + l.handling_in_charge, 0);
  const unloading = clientLines.reduce((s, l) => s + l.handling_out_charge, 0);
  const total = storage + loading + unloading;

  useEffect(() => {
    if (open) {
      setStart(suggestedStart(clientRuns) ?? reportStart);
      setEnd(reportEnd);
      setPuntoVenta("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.client_id, reportStart, reportEnd]);

  // Preselects the client's only channel once the channels arrive.
  useEffect(() => {
    if (open) {
      setChannelId(sideChannels.length === 1 ? sideChannels[0]!.id : "");
      setPuntoVenta("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.client_id, channels]);

  const gap = start ? uncoveredGap(clientRuns, start) : null;
  const overlaps =
    start && end ? overlapsBilled(channelRuns, start, end) : false;
  const pendingOverlap =
    start && end && !overlaps
      ? overlapsBilled(clientPending, start, end)
      : false;
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
              <DatePicker
                id="storage-start"
                value={start}
                max={end}
                onChange={setStart}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="storage-end">Hasta</Label>
              <DatePicker
                id="storage-end"
                value={end}
                min={start}
                onChange={setEnd}
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
              cliente{channelId ? " en este canal" : ""}.
            </p>
          )}
          {pendingOverlap && (
            <p className="flex items-start gap-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              <AlertTriangle className="size-4 shrink-0" />
              Un intento anterior de facturar este período quedó sin registrar.
              Pasados 15 minutos de ese intento, «Emitir factura» registra su
              factura si se emitió, sin emitir otra; si falló o se anuló,
              factura el período de nuevo.
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
                {sideChannels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.is_fiscal ? " (fiscal)" : " (interna)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {channelsQuery.isError && (
              <ReadError
                message="No se pudieron cargar los canales."
                onRetry={() => void channelsQuery.refetch()}
              />
            )}
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
            {channelId && posQuery.isError && (
              <ReadError
                message="No se pudieron cargar los puntos de venta."
                onRetry={() => void posQuery.refetch()}
              />
            )}
          </div>

          <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
            {previewMissing ? (
              <ReadError
                message="No se pudo calcular el total: no se puede emitir hasta recalcularlo."
                onRetry={() => void refetchPreview()}
              />
            ) : (
              <>
                <Row label="Almacenaje" value={money(storage)} />
                <Row label="Carga" value={money(loading)} />
                <Row label="Descarga" value={money(unloading)} />
                <div className="mt-1 flex items-center justify-between border-t pt-1 font-medium">
                  <span>Total</span>
                  <span className="font-mono">{money(total)}</span>
                </div>
                {isFetching && (
                  <p className="text-muted-foreground text-xs">Calculando…</p>
                )}
              </>
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
              previewMissing ||
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
