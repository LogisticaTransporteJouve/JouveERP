import { redirect } from "next/navigation";

import { listMaintenanceAction } from "@/features/maintenance/actions/maintenance-actions";
import { MaintenanceTable } from "@/features/maintenance/components/maintenance-table";
import { maintenanceKeys } from "@/features/maintenance/lib/maintenance-keys";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function MaintenancePageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "maintenance:read")) {
    redirect("/dashboard");
  }

  const [dehydratedState, vehiclesRes] = await Promise.all([
    prefetchQueries([
      {
        queryKey: maintenanceKeys.list(),
        queryFn: () => runAction(() => listMaintenanceAction()),
      },
    ]),
    listVehiclesAction({ onlyActive: true }),
  ]);

  const vehicleOptions = vehiclesRes.ok
    ? vehiclesRes.data.map((v) => ({ id: v.id, patente: v.patente }))
    : [];

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <MaintenanceTable vehicleOptions={vehicleOptions} />
      </div>
    </Hydrate>
  );
}
