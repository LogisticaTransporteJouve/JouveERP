import { redirect } from "next/navigation";

import { getVehicleKmRangeAction } from "@/features/vehicle-km/actions/vehicle-km-actions";
import { VehicleKmView } from "@/features/vehicle-km/components/vehicle-km-view";
import { kmPeriod } from "@/features/vehicle-km/lib/km-period";
import { vehicleKmKeys } from "@/features/vehicle-km/lib/vehicle-km-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { resolvePeriod } from "@/lib/list-period";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function VehicleKmPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_km:read")) {
    redirect("/dashboard");
  }
  const range = kmPeriod(
    resolvePeriod({ preset: "this_month", from: null, to: null }, todayInAR()),
  );
  const dehydratedState = await prefetchQueries([
    {
      queryKey: vehicleKmKeys.range(range.from, range.to),
      queryFn: () => runAction(() => getVehicleKmRangeAction(range)),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <VehicleKmView
        canWrite={userCan(ctx.access, "fleet_km:write")}
        canAdmin={userCan(ctx.access, "fleet_km:admin")}
      />
    </Hydrate>
  );
}
