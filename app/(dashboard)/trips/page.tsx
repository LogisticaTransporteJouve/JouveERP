import { redirect } from "next/navigation";

import { listDriversAction } from "@/features/drivers/actions/drivers-actions";
import { TripsTable } from "@/features/trips/components/trips-table";
import { tripsKeys } from "@/features/trips/lib/trips-keys";
import { listTripsAction } from "@/features/trips/actions/trips-actions";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function TripsPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "trips:read")) {
    redirect("/dashboard");
  }

  const [dehydratedState, driversRes, vehiclesRes] = await Promise.all([
    prefetchQueries([
      {
        queryKey: tripsKeys.list(),
        queryFn: () => runAction(() => listTripsAction()),
      },
    ]),
    listDriversAction({ onlyActive: true }),
    listVehiclesAction({ onlyActive: true }),
  ]);

  const driverOptions = driversRes.ok
    ? driversRes.data.map((d) => ({ id: d.id, full_name: d.full_name }))
    : [];
  const vehicleOptions = vehiclesRes.ok
    ? vehiclesRes.data.map((v) => ({ id: v.id, patente: v.patente }))
    : [];

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <TripsTable
          driverOptions={driverOptions}
          vehicleOptions={vehicleOptions}
        />
      </div>
    </Hydrate>
  );
}
