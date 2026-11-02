"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AttachmentsZone } from "@/features/files/components/attachments-zone";
import { formatArgentineDate } from "@/lib/format";

import type { FuelLoad } from "../schema";

export type FuelFileAccess = { write: boolean; delete: boolean };

/** The photo or file of a load's ticket / remito (file_attachments). */
export function FuelTicketDialog({
  fuelLoad,
  access,
  onOpenChange,
}: {
  fuelLoad: FuelLoad | null;
  access: FuelFileAccess;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={fuelLoad !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ticket de la carga</DialogTitle>
          <DialogDescription>
            {fuelLoad
              ? `${fuelLoad.vehicle?.patente ?? "Vehículo"} · ${formatArgentineDate(fuelLoad.load_date)}. Desde el celular podés sacarle una foto al remito.`
              : null}
          </DialogDescription>
        </DialogHeader>
        {fuelLoad && (
          <AttachmentsZone
            targetType="fuel_load"
            targetId={fuelLoad.id}
            canWrite={access.write}
            canDelete={access.delete}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
