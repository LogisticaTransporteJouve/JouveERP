"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DisabledHint } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useSetShipmentsTrip } from "../hooks/use-shipments";

import { UnassignedShipmentsPicker } from "./unassigned-shipments-picker";

/** Picks cargas still without a trip and puts them on this one. */
export function AssignShipmentsDialog({
  tripId,
  open,
  onOpenChange,
}: {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const assign = useSetShipmentsTrip();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function close(next: boolean) {
    if (!next) setSelected(new Set());
    onOpenChange(next);
  }

  function submit() {
    const shipmentIds = [...selected];
    assign.mutate(
      { tripId, shipmentIds },
      {
        onSuccess: ({ count, warning }) => {
          if (warning) {
            toast.warning(warning);
          } else if (count < shipmentIds.length) {
            toast.warning(
              `Se asignaron ${count} de ${shipmentIds.length} cargas: las demás ya estaban en otro viaje.`,
            );
          } else {
            toast.success(
              count === 1 ? "Carga asignada." : `${count} cargas asignadas.`,
            );
          }
          close(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Asignar cargas</DialogTitle>
          <DialogDescription>
            Cargas sin viaje, pendientes o reprogramadas. Elegí las que van en
            este viaje.
          </DialogDescription>
        </DialogHeader>
        <UnassignedShipmentsPicker
          enabled={open}
          selected={selected}
          onToggle={toggle}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancelar
          </Button>
          <DisabledHint
            reason={selected.size === 0 ? "Elegí al menos una carga." : null}
          >
            <Button
              disabled={selected.size === 0 || assign.isPending}
              onClick={submit}
            >
              {selected.size > 1
                ? `Asignar ${selected.size} cargas`
                : "Asignar"}
            </Button>
          </DisabledHint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
