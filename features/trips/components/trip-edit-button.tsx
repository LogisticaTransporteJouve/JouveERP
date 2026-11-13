"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { Trip } from "../schema";

import { TripDialog } from "./trip-dialog";

/** «Editar viaje» on the trip's page: the same dialog as the trips list
 *  (date, vehicle, driver, companion and status, with the shared carga
 *  sync of updateTripAction); the page re-reads the trip when it closes. */
export function TripEditButton({
  trip,
  driverOptions,
  vehicleOptions,
}: {
  trip: Trip;
  driverOptions: { id: string; full_name: string }[];
  vehicleOptions: { id: string; patente: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        Editar viaje
      </Button>
      {open && (
        <TripDialog
          mode="edit"
          trip={trip}
          driverOptions={driverOptions}
          vehicleOptions={vehicleOptions}
          canAssign={false}
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) router.refresh();
          }}
        />
      )}
    </>
  );
}
