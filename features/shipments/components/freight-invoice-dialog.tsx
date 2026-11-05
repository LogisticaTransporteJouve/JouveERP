"use client";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { PosSelect } from "@/features/invoices/components/pos-select";

import { useInvoiceFreight, useShipmentOptions } from "../hooks/use-shipments";
import { type Shipment } from "../schema";

function formatMoney(n: number | null): string {
  if (n === null) return "—";
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

export function FreightInvoiceDialog({
  shipment,
  onClose,
}: {
  shipment: Shipment | null;
  onClose: () => void;
}) {
  const {
    data: options,
    isError: optionsFailed,
    refetch: refetchOptions,
  } = useShipmentOptions();
  const invoiceMut = useInvoiceFreight();
  const [channelId, setChannelId] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("");

  const open = shipment !== null;
  const channels = options?.channels;
  // A Ventas client is invoiced on a fiscal channel and an Otras ventas one
  // on an internal channel (issueFiscalInvoiceAction refuses the other). The
  // carga's own channel stays listed: the select shows it, locked.
  const clientIsFiscal = shipment?.client?.is_fiscal;
  const sideChannels = (channels ?? []).filter(
    (c) =>
      clientIsFiscal == null ||
      c.is_fiscal === clientIsFiscal ||
      c.id === shipment?.channel_id,
  );

  // Preselects the carga's channel, or the client's only one once the
  // channels arrive.
  useEffect(() => {
    if (open) {
      setChannelId(
        shipment?.channel_id ??
          (sideChannels.length === 1 ? sideChannels[0]!.id : ""),
      );
      setPuntoVenta("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shipment, channels]);

  function onSubmit() {
    if (!shipment) return;
    if (channelId === "") {
      toast.error("Elegí un canal.");
      return;
    }
    if (puntoVenta.trim() === "") {
      toast.error("Elegí un punto de venta.");
      return;
    }
    invoiceMut.mutate(
      {
        shipmentId: shipment.id,
        channel_id: channelId,
        punto_venta: Number(puntoVenta),
      },
      {
        onSuccess: () => {
          toast.success("Factura de flete creada.");
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
          <DialogTitle>Facturar flete</DialogTitle>
          <DialogDescription>
            Generá la factura del flete de esta carga.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Cliente</span>
              <span className="font-medium">
                {shipment?.client?.legal_name ?? "—"}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Flete</span>
              <span className="font-medium">
                {formatMoney(shipment?.freight_amount ?? null)}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="freight-channel">Canal</Label>
            {((optionsFailed && !options) || options?.channels === null) && (
              <ReadError
                message="No se pudieron cargar los canales."
                onRetry={() => void refetchOptions()}
              />
            )}
            <Select
              value={channelId}
              onValueChange={setChannelId}
              disabled={!!shipment?.channel_id}
            >
              <SelectTrigger id="freight-channel">
                <SelectValue placeholder="Elegí un canal" />
              </SelectTrigger>
              <SelectContent>
                {sideChannels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="freight-pos">Punto de venta</Label>
            <PosSelect
              id="freight-pos"
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
            Facturar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
