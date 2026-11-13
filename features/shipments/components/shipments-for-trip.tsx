"use client";

import { MoreHorizontal, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatArgentineDate } from "@/lib/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  ACTION_ICON,
  ACTION_LABEL,
  statusActions,
} from "./shipment-status-actions";
import {
  ShipmentStatusDialog,
  type ShipmentStatusAction,
} from "./shipment-status-dialog";

export function ShipmentsForTrip({
  tripId,
  canWrite,
  canAssignTrip = false,
}: {
  tripId: string;
  canWrite: boolean;
  /** Reprogramming can put the carga on a trip of its new date. */
  canAssignTrip?: boolean;
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
      <TripShipments
        tripId={tripId}
        canWrite={canWrite}
        canAssignTrip={canAssignTrip}
      />
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
  canAssignTrip,
}: {
  tripId: string;
  canWrite: boolean;
  canAssignTrip: boolean;
}) {
  const { data: items, isLoading, isError } = useShipmentsByTrip(tripId);
  const unassign = useSetShipmentsTrip();
  // Entregar / Cancelar / Reprogramar: the cargas list's dialog and command
  // (reprogramming a started carga takes it off this trip).
  const [statusDialog, setStatusDialog] = useState<{
    shipment: Shipment;
    action: ShipmentStatusAction;
  } | null>(null);

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
            {canWrite && <TableHead className="w-20" />}
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
                  <div className="flex items-center justify-end gap-1">
                    {statusActions(shipment.status).length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton label="Cambiar estado" variant="ghost">
                            <MoreHorizontal className="size-4" />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {statusActions(shipment.status).map((action) => {
                            const Icon = ACTION_ICON[action];
                            return (
                              <DropdownMenuItem
                                key={action}
                                className={
                                  action === "cancel" ? "text-destructive" : ""
                                }
                                onClick={() =>
                                  setStatusDialog({ shipment, action })
                                }
                              >
                                <Icon className="size-4" />
                                {ACTION_LABEL[action]}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <IconButton
                      label="Quitar del viaje"
                      variant="ghost"
                      disabled={unassign.isPending}
                      onClick={() => remove(shipment.id)}
                    >
                      <X className="size-4" />
                    </IconButton>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {canWrite && (
        <ShipmentStatusDialog
          shipment={statusDialog?.shipment ?? null}
          action={statusDialog?.action ?? null}
          onClose={() => setStatusDialog(null)}
          canAssignTrip={canAssignTrip}
        />
      )}
    </div>
  );
}
