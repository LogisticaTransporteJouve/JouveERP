"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { useShipmentHistory } from "../hooks/use-shipments";
import { SHIPMENT_STATUS_LABELS, isShipmentStatus } from "../schema";

function statusLabel(value: string | null): string {
  if (value === null) return "—";
  return isShipmentStatus(value) ? SHIPMENT_STATUS_LABELS[value] : value;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("es-AR");
}

export function ShipmentHistoryDialog({
  shipmentId,
  onClose,
}: {
  shipmentId: string | null;
  onClose: () => void;
}) {
  const { data: entries, isLoading } = useShipmentHistory(shipmentId);

  return (
    <Dialog
      open={shipmentId !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Historial de estados</DialogTitle>
          <DialogDescription>
            Cambios de estado registrados para esta carga.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !entries || entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sin cambios de estado.
          </p>
        ) : (
          <ol className="space-y-4">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="border-l-2 border-border pl-3 text-sm"
              >
                <div className="font-medium">
                  {statusLabel(entry.old_status)} →{" "}
                  {statusLabel(entry.new_status)}
                </div>
                {entry.comment && (
                  <p className="text-muted-foreground">{entry.comment}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatDate(entry.changed_at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
