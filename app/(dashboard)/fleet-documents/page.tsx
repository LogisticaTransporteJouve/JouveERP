import { redirect } from "next/navigation";

import { listDriversAction } from "@/features/drivers/actions/drivers-actions";
import { listFleetDocumentsAction } from "@/features/fleet-documents/actions/fleet-documents-actions";
import { FleetDocumentsTable } from "@/features/fleet-documents/components/fleet-documents-table";
import { fleetDocumentsKeys } from "@/features/fleet-documents/lib/fleet-documents-keys";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function FleetDocumentsPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "fleet_documents:read")) {
    redirect("/dashboard");
  }

  const [dehydratedState, vehiclesRes, driversRes] = await Promise.all([
    prefetchQueries([
      {
        queryKey: fleetDocumentsKeys.list(),
        queryFn: () => runAction(() => listFleetDocumentsAction()),
      },
    ]),
    listVehiclesAction({ onlyActive: true }),
    listDriversAction({ onlyActive: true }),
  ]);

  const vehicleOptions = vehiclesRes.ok
    ? vehiclesRes.data.map((v) => ({ id: v.id, patente: v.patente }))
    : [];
  const driverOptions = driversRes.ok
    ? driversRes.data.map((d) => ({ id: d.id, full_name: d.full_name }))
    : [];

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <FleetDocumentsTable
          vehicleOptions={vehicleOptions}
          driverOptions={driverOptions}
        />
      </div>
    </Hydrate>
  );
}
