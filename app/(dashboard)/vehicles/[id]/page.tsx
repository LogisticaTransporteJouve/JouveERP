import { notFound, redirect } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { getVehicleKmDaysAction } from "@/features/vehicle-km/actions/vehicle-km-actions";
import { VehicleKmDays } from "@/features/vehicle-km/components/vehicle-km-days";
import { kmPeriod } from "@/features/vehicle-km/lib/km-period";
import { vehicleKmKeys } from "@/features/vehicle-km/lib/vehicle-km-keys";
import { getVehicleAction } from "@/features/vehicles/actions/vehicles-actions";
import { VEHICLE_TYPE_LABELS } from "@/features/vehicles/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { resolvePeriod } from "@/lib/list-period";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "vehicles:read")) {
    redirect("/dashboard");
  }
  const { id } = await params;
  const result = await getVehicleAction(id);
  if (!result.ok) {
    redirect("/vehicles");
  }
  if (!result.data) {
    notFound();
  }
  const vehicle = result.data;
  const seesKm = userCan(ctx.access, "fleet_km:read");
  const range = kmPeriod(
    resolvePeriod({ preset: "this_month", from: null, to: null }, todayInAR()),
  );
  const dehydratedState = seesKm
    ? await prefetchQueries([
        {
          queryKey: vehicleKmKeys.days(id, range.from, range.to),
          queryFn: () =>
            runAction(() =>
              getVehicleKmDaysAction({ vehicle_id: id, ...range }),
            ),
        },
      ])
    : null;

  const facts = [
    VEHICLE_TYPE_LABELS[vehicle.vehicle_type],
    [vehicle.brand, vehicle.model].filter(Boolean).join(" "),
    vehicle.year ? String(vehicle.year) : "",
    vehicle.is_active ? "" : "Inactivo",
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/vehicles">Vehículos</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{vehicle.patente}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="space-y-1">
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          {vehicle.patente}
          {vehicle.alias && (
            <span className="text-muted-foreground ml-3 font-sans text-base font-normal">
              {vehicle.alias}
            </span>
          )}
        </h1>
        <p className="text-muted-foreground text-sm">{facts.join(" · ")}</p>
      </div>

      {seesKm && dehydratedState && (
        <Hydrate state={dehydratedState}>
          <VehicleKmDays
            vehicleId={id}
            canWrite={userCan(ctx.access, "fleet_km:write")}
            canAdmin={userCan(ctx.access, "fleet_km:admin")}
            showDrivers={userCan(ctx.access, "trips:read")}
            linkDrivers={userCan(ctx.access, "drivers:read")}
          />
        </Hydrate>
      )}
    </div>
  );
}
