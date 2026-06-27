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
import { Textarea } from "@/components/ui/textarea";

import { useChangeShipmentStatus } from "../hooks/use-shipments";
import { type Shipment, type ShipmentStatus } from "../schema";

export type ShipmentStatusAction =
  | "start"
  | "deliver"
  | "cancel"
  | "reprogram";

const ACTION_STATUS: Record<ShipmentStatusAction, ShipmentStatus> = {
  start: "in_progress",
  deliver: "delivered",
  cancel: "cancelled",
  reprogram: "reprogrammed",
};

const ACTION_TITLE: Record<ShipmentStatusAction, string> = {
  start: "Iniciar carga",
  deliver: "Entregar carga",
  cancel: "Cancelar carga",
  reprogram: "Reprogramar carga",
};

const ACTION_DESCRIPTION: Record<ShipmentStatusAction, string> = {
  start: "La carga pasa a estar en progreso.",
  deliver: "Registrá la fecha de entrega.",
  cancel: "Indicá el motivo de la cancelación.",
  reprogram: "Definí la nueva fecha y el motivo.",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ShipmentStatusDialog({
  shipment,
  action,
  onClose,
}: {
  shipment: Shipment | null;
  action: ShipmentStatusAction | null;
  onClose: () => void;
}) {
  const changeMut = useChangeShipmentStatus();
  const [comment, setComment] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(today());
  const [failureReason, setFailureReason] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");

  const open = shipment !== null && action !== null;

  useEffect(() => {
    if (open) {
      setComment("");
      setDeliveryDate(today());
      setFailureReason("");
      setScheduledDate(shipment?.scheduled_date ?? "");
    }
  }, [open, shipment]);

  function handleOpenChange(next: boolean) {
    if (!next) onClose();
  }

  function onSubmit() {
    if (!shipment || !action) return;
    if (action === "cancel" && failureReason.trim() === "") {
      toast.error("El motivo es obligatorio.");
      return;
    }
    const payload = {
      id: shipment.id,
      status: ACTION_STATUS[action],
      comment,
      delivery_date: action === "deliver" ? deliveryDate : "",
      failure_reason:
        action === "cancel" || action === "reprogram" ? failureReason : "",
      scheduled_date: action === "reprogram" ? scheduledDate : "",
    };
    changeMut.mutate(payload, {
      onSuccess: () => {
        toast.success("Estado actualizado.");
        onClose();
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{action ? ACTION_TITLE[action] : ""}</DialogTitle>
          <DialogDescription>
            {action ? ACTION_DESCRIPTION[action] : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {action === "deliver" && (
            <div className="space-y-2">
              <Label htmlFor="shipment-delivery-date">Fecha de entrega</Label>
              <Input
                id="shipment-delivery-date"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </div>
          )}
          {action === "reprogram" && (
            <div className="space-y-2">
              <Label htmlFor="shipment-scheduled-date">
                Nueva fecha programada
              </Label>
              <Input
                id="shipment-scheduled-date"
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>
          )}
          {(action === "cancel" || action === "reprogram") && (
            <div className="space-y-2">
              <Label htmlFor="shipment-failure-reason">
                Motivo{action === "cancel" ? "" : " (opcional)"}
              </Label>
              <Textarea
                id="shipment-failure-reason"
                rows={2}
                value={failureReason}
                onChange={(e) => setFailureReason(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="shipment-comment">Comentario</Label>
            <Textarea
              id="shipment-comment"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant={action === "cancel" ? "destructive" : "default"}
            disabled={changeMut.isPending}
            onClick={onSubmit}
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
