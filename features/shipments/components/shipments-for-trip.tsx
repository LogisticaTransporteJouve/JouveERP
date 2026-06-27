"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useShipmentsByTrip } from "../hooks/use-shipments";
import { type Shipment } from "../schema";

import { ShipmentStatusBadge } from "./shipment-status";

function formatMoney(n: number | null): string {
  if (n === null) return "—";
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

function formatRoute(origin: string | null, destination: string | null): string {
  if (!origin && !destination) return "—";
  return `${origin ?? "—"} → ${destination ?? "—"}`;
}

export function ShipmentsForTrip({ tripId }: { tripId: string }) {
  const { data: items, isLoading } = useShipmentsByTrip(tripId);

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        Este viaje no tiene cargas.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>Ruta</TableHead>
            <TableHead className="w-36">Estado</TableHead>
            <TableHead className="w-28 text-right">Flete</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((shipment: Shipment) => (
            <TableRow key={shipment.id}>
              <TableCell className="font-medium">
                {shipment.client?.legal_name ?? "—"}
              </TableCell>
              <TableCell className="text-sm">
                {formatRoute(shipment.origin, shipment.destination)}
              </TableCell>
              <TableCell>
                <ShipmentStatusBadge status={shipment.status} />
              </TableCell>
              <TableCell className="text-right text-sm">
                {formatMoney(shipment.freight_amount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
