import { redirect } from "next/navigation";

import { getVehicleKmMonthAction } from "@/features/vehicle-km/actions/vehicle-km-actions";
import { VehicleKmView } from "@/features/vehicle-km/components/vehicle-km-view";
import { vehicleKmKeys } from "@/features/vehicle-km/lib/vehicle-km-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function VehicleKmPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fleet_km:read")) {
    redirect("/dashboard");
  }
  const period = todayInAR().slice(0, 7);
  const dehydratedState = await prefetchQueries([
    {
      queryKey: vehicleKmKeys.month(period),
      queryFn: () => runAction(() => getVehicleKmMonthAction({ period })),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <VehicleKmView
        initialPeriod={period}
        canWrite={userCan(ctx.access, "fleet_km:write")}
      />
    </Hydrate>
  );
}
