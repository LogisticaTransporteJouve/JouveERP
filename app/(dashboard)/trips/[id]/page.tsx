import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { IconButton } from "@/components/ui/icon-button";
import { RecordHistory } from "@/features/audit/components/record-history";
import { listDriversAction } from "@/features/drivers/actions/drivers-actions";
import { getTripAction } from "@/features/trips/actions/trips-actions";
import { TripEditButton } from "@/features/trips/components/trip-edit-button";
import { TRIP_STATUS_LABELS } from "@/features/trips/schema";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";
import { ShipmentsForTrip } from "@/features/shipments/components/shipments-for-trip";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  // The page is the trip's cargas, which listShipmentsByTripAction reads
  // under shipments:read.
  if (!userCanAll(ctx.access, ["trips:read", "shipments:read"])) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const result = await getTripAction(id);
  if (!result.ok) {
    redirect("/trips");
  }
  if (!result.data) {
    notFound();
  }

  const trip = result.data;
  const fleet = [
    trip.driver?.full_name,
    trip.vehicle?.patente,
    trip.companion?.legal_name && `Acompañante: ${trip.companion.legal_name}`,
    TRIP_STATUS_LABELS[trip.status],
  ]
    .filter((v): v is string => Boolean(v))
    .join(" · ");

  // Editing the trip is the trips list's dialog, under its permission. The
  // pickers keep the trip's current driver and vehicle even when inactive.
  const canEditTrip = userCan(ctx.access, "trips:write");
  const [driversRes, vehiclesRes] = canEditTrip
    ? await Promise.all([
        listDriversAction({ onlyActive: true }),
        listVehiclesAction({ onlyActive: true }),
      ])
    : [null, null];
  const driverOptions = withCurrent(
    driversRes?.ok
      ? driversRes.data.map((d) => ({ id: d.id, full_name: d.full_name }))
      : [],
    trip.driver_id && trip.driver
      ? { id: trip.driver_id, full_name: trip.driver.full_name }
      : null,
  );
  const vehicleOptions = withCurrent(
    vehiclesRes?.ok
      ? vehiclesRes.data.map((v) => ({ id: v.id, patente: v.patente }))
      : [],
    trip.vehicle_id && trip.vehicle
      ? { id: trip.vehicle_id, patente: trip.vehicle.patente }
      : null,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <IconButton label="Volver a viajes" variant="ghost" asChild>
          <Link href="/trips">
            <ArrowLeft className="size-4" />
          </Link>
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Viaje del {formatArgentineDate(trip.trip_date)}
          </h1>
          {fleet && <p className="text-sm text-muted-foreground">{fleet}</p>}
        </div>
        {canEditTrip && (
          <TripEditButton
            trip={trip}
            driverOptions={driverOptions}
            vehicleOptions={vehicleOptions}
          />
        )}
      </div>

      <ShipmentsForTrip
        tripId={id}
        canWrite={userCan(ctx.access, "shipments:write")}
        canAssignTrip={userCanAll(ctx.access, [
          "shipments:write",
          "trips:read",
          "trips:write",
        ])}
      />

      {userCan(ctx.access, "audit:read") && (
        <RecordHistory resourceId={trip.id} />
      )}
    </div>
  );
}

/** The active options plus the trip's own one when it is not among them. */
function withCurrent<T extends { id: string }>(
  options: T[],
  current: T | null,
): T[] {
  if (!current || options.some((o) => o.id === current.id)) return options;
  return [current, ...options];
}
