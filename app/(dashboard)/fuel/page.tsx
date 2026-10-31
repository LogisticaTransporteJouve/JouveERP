import { redirect } from "next/navigation";

import { listFuelLoadsAction } from "@/features/fuel/actions/fuel-actions";
import { FuelTable } from "@/features/fuel/components/fuel-table";
import { fuelKeys } from "@/features/fuel/lib/fuel-keys";
import { listTripsAction } from "@/features/trips/actions/trips-actions";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { costVoucherAccess } from "@/lib/cost-vouchers";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function FuelPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fuel:read")) {
    redirect("/dashboard");
  }

  const [dehydratedState, vehiclesRes, tripsRes] = await Promise.all([
    prefetchQueries([
      {
        queryKey: fuelKeys.list(),
        queryFn: () => runAction(() => listFuelLoadsAction()),
      },
    ]),
    listVehiclesAction({ onlyActive: true }),
    listTripsAction(),
  ]);

  const vehicleOptions = vehiclesRes.ok
    ? vehiclesRes.data.map((v) => ({ id: v.id, patente: v.patente }))
    : [];
  const tripOptions = tripsRes.ok
    ? tripsRes.data.map((t) => ({
        id: t.id,
        trip_date: t.trip_date,
        origin: t.origin,
        destination: t.destination,
      }))
    : [];

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <FuelTable
          vehicleOptions={vehicleOptions}
          tripOptions={tripOptions}
          voucherAccess={costVoucherAccess(ctx.access)}
        />
      </div>
    </Hydrate>
  );
}
