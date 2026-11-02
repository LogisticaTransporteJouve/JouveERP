"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import {
  useSetShipmentsTrip,
  useUnassignedShipments,
} from "../hooks/use-shipments";
import { formatRoute } from "../lib/format";

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
  const { data: items, isLoading, isError } = useUnassignedShipments(open);
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
        onSuccess: ({ count }) => {
          if (count < shipmentIds.length) {
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
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {isLoading ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </>
          ) : isError ? (
            <p className="text-sm text-muted-foreground">
              No se pudieron cargar las cargas sin viaje.
            </p>
          ) : !items || items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay cargas sin viaje. Creálas en Cargas.
            </p>
          ) : (
            items.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm hover:bg-muted/50"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(s.id)}
                  onCheckedChange={(v) => toggle(s.id, v === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {s.client?.legal_name ?? "Sin cliente"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatRoute(s.origin, s.destination)}
                    {s.scheduled_date ? ` · ${s.scheduled_date}` : ""}
                    {s.description ? ` · ${s.description}` : ""}
                  </span>
                </span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button
            disabled={selected.size === 0 || assign.isPending}
            onClick={submit}
          >
            {selected.size > 1 ? `Asignar ${selected.size} cargas` : "Asignar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
