import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getTripAction } from "@/features/trips/actions/trips-actions";
import { ShipmentsForTrip } from "@/features/shipments/components/shipments-for-trip";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";

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
  const fleet = [trip.driver?.full_name, trip.vehicle?.patente]
    .filter((v): v is string => Boolean(v))
    .join(" · ");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/trips" aria-label="Volver a viajes">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Viaje del {trip.trip_date}
          </h1>
          {fleet && <p className="text-sm text-muted-foreground">{fleet}</p>}
        </div>
      </div>

      <ShipmentsForTrip
        tripId={id}
        canWrite={userCan(ctx.access, "shipments:write")}
      />
    </div>
  );
}
