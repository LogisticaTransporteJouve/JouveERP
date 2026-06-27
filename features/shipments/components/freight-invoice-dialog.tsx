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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const { data: options } = useShipmentOptions();
  const invoiceMut = useInvoiceFreight();
  const [channelId, setChannelId] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("");

  const open = shipment !== null;

  useEffect(() => {
    if (open) {
      setChannelId(shipment?.channel_id ?? "");
      setPuntoVenta("");
    }
  }, [open, shipment]);

  function onSubmit() {
    if (!shipment) return;
    if (channelId === "") {
      toast.error("Elegí un canal.");
      return;
    }
    if (puntoVenta.trim() === "") {
      toast.error("Ingresá el punto de venta.");
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
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger id="freight-channel">
                <SelectValue placeholder="Elegí un canal" />
              </SelectTrigger>
              <SelectContent>
                {(options?.channels ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="freight-pos">Punto de venta</Label>
            <Input
              id="freight-pos"
              type="number"
              inputMode="numeric"
              min="1"
              value={puntoVenta}
              onChange={(e) => setPuntoVenta(e.target.value)}
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
