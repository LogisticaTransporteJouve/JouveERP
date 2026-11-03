"use client";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/format";

import { PosSelect } from "@/features/invoices/components/pos-select";

import {
  useInvoiceFreightSettlement,
  useInvoicingChannels,
} from "../hooks/use-freight-settlements";
import {
  settlementDocumentLabel,
  settlementSide,
  type FreightSettlement,
} from "../schema";

/** One invoice for the whole liquidación, on a channel of the client's side:
 *  "Facturar" in Ventas (Factura A/B with CAE, after the Remito R), "Emitir
 *  remito interno" in Otras ventas (the remito interno X, confirming a draft
 *  first; the final step). */
export function FreightSettlementInvoiceDialog({
  settlement,
  onClose,
}: {
  settlement: FreightSettlement | null;
  onClose: () => void;
}) {
  const open = settlement !== null;
  const internal =
    settlement !== null && settlementSide(settlement) === "internal";
  const document = settlement ? settlementDocumentLabel(settlement) : null;
  const channels = useInvoicingChannels(open);
  const invoiceMut = useInvoiceFreightSettlement();
  const [channelId, setChannelId] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("");

  const sideChannels = (channels.data ?? []).filter(
    (c) => c.is_fiscal === settlement?.client_is_fiscal,
  );

  useEffect(() => {
    if (!open) return;
    setPuntoVenta("");
    setChannelId(sideChannels.length === 1 ? sideChannels[0]!.id : "");
    // Re-pick only when the dialog opens or the channels arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channels.data]);

  function onSubmit() {
    if (!settlement) return;
    if (channelId === "") {
      toast.error("Elegí un canal.");
      return;
    }
    if (puntoVenta === "") {
      toast.error("Elegí un punto de venta.");
      return;
    }
    invoiceMut.mutate(
      {
        id: settlement.id,
        channel_id: channelId,
        punto_venta: Number(puntoVenta),
      },
      {
        onSuccess: () => {
          toast.success(
            internal
              ? "Remito interno de la liquidación emitido."
              : "Factura de la liquidación creada.",
          );
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
          <DialogTitle>
            {internal ? "Emitir remito interno" : "Facturar liquidación"}
          </DialogTitle>
          <DialogDescription>
            {internal
              ? `${settlement?.status === "draft" ? "Se confirma la liquidación y se emite un" : "Un"} solo remito interno con una línea por carga, a precio final. Es el documento final de la liquidación.`
              : "Una sola factura con una línea por carga, con IVA 21%, vinculada al Remito R."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            {document && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Documento</span>
                <span className="font-medium">{document}</span>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Cliente</span>
              <span className="truncate font-medium">
                {settlement?.client_name ?? "—"}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {settlement?.client_is_fiscal ? "Neto" : "Total"}
              </span>
              <span className="font-medium tabular-nums">
                {settlement ? formatMoney(settlement.total) : "—"}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fs-channel">Canal</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger id="fs-channel" className="w-full">
                <SelectValue
                  placeholder={
                    channels.isLoading ? "Cargando…" : "Elegí un canal"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sideChannels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {channels.isError && (
              <p className="text-sm text-muted-foreground">
                No se pudieron cargar los canales: {channels.error.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="fs-pos">Punto de venta</Label>
            <PosSelect
              id="fs-pos"
              channelId={channelId || null}
              value={puntoVenta}
              onChange={setPuntoVenta}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={invoiceMut.isPending}
            onClick={onSubmit}
          >
            {internal ? "Emitir remito interno" : "Facturar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
