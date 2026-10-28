import { redirect } from "next/navigation";

import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";
import { VehiclesTable } from "@/features/vehicles/components/vehicles-table";
import { vehiclesKeys } from "@/features/vehicles/lib/vehicles-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function VehiclesPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "vehicles:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: vehiclesKeys.list(false),
      queryFn: () => runAction(() => listVehiclesAction({ onlyActive: false })),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <VehiclesTable />
      </div>
    </Hydrate>
  );
}
