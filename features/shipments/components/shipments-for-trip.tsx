"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatArgentineDate } from "@/lib/format";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  useSetShipmentsTrip,
  useShipmentsByTrip,
} from "../hooks/use-shipments";
import { shipmentRoute } from "../lib/format";
import { SHIPMENT_KIND_LABELS, type Shipment } from "../schema";

import { AssignShipmentsDialog } from "./assign-shipments-dialog";
import { ShipmentStatusBadge } from "./shipment-status";

export function ShipmentsForTrip({
  tripId,
  canWrite,
}: {
  tripId: string;
  canWrite: boolean;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-medium tracking-tight">Cargas del viaje</h2>
        {canWrite && (
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => setAssignOpen(true)}
          >
            <Plus className="size-4" />
            Asignar cargas
          </Button>
        )}
      </div>
      <TripShipments tripId={tripId} canWrite={canWrite} />
      {canWrite && (
        <AssignShipmentsDialog
          tripId={tripId}
          open={assignOpen}
          onOpenChange={setAssignOpen}
        />
      )}
    </div>
  );
}

function TripShipments({
  tripId,
  canWrite,
}: {
  tripId: string;
  canWrite: boolean;
}) {
  const { data: items, isLoading, isError } = useShipmentsByTrip(tripId);
  const unassign = useSetShipmentsTrip();

  function remove(id: string) {
    unassign.mutate(
      { tripId: null, shipmentIds: [id] },
      {
        onSuccess: ({ warning }) => {
          if (warning) toast.warning(warning);
          else toast.success("Carga quitada del viaje.");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        No se pudieron cargar las cargas del viaje.
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        Este viaje no tiene cargas.
        {canWrite && " Asigná las que van con “Asignar cargas”."}
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>Carga → Descarga</TableHead>
            <TableHead className="w-36">Estado</TableHead>
            {canWrite && <TableHead className="w-12" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((shipment: Shipment) => (
            <TableRow key={shipment.id}>
              <TableCell className="whitespace-normal">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">
                    {shipment.client?.legal_name ?? "—"}
                  </span>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {SHIPMENT_KIND_LABELS[shipment.kind]}
                  </Badge>
                </span>
                {(shipment.unload_date || shipment.time_window) && (
                  <span className="block text-xs text-muted-foreground">
                    {[
                      shipment.unload_date &&
                        `Descarga ${formatArgentineDate(shipment.unload_date)}`,
                      shipment.time_window,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </TableCell>
              <TableCell className="whitespace-normal text-sm">
                {shipmentRoute(shipment)}
              </TableCell>
              <TableCell>
                <ShipmentStatusBadge status={shipment.status} />
              </TableCell>
              {canWrite && (
                <TableCell>
                  <IconButton
                    label="Quitar del viaje"
                    variant="ghost"
                    disabled={unassign.isPending}
                    onClick={() => remove(shipment.id)}
                  >
                    <X className="size-4" />
                  </IconButton>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
