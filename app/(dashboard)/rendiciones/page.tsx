import { redirect } from "next/navigation";

import {
  listCodPendingAction,
  listDriverSettlementsAction,
} from "@/features/driver-settlements/actions/driver-settlements-actions";
import { DriverSettlementsPage } from "@/features/driver-settlements/components/driver-settlements-page";
import { CHARGE_DRIVER_PERMISSIONS } from "@/features/driver-settlements/lib/charge-driver";
import { driverSettlementsKeys } from "@/features/driver-settlements/lib/driver-settlements-keys";
import { DRIVER_SETTLEMENTS_PAGE_SIZE } from "@/features/driver-settlements/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function RendicionesRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: driverSettlementsKeys.list(),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          listDriverSettlementsAction({
            offset: pageParam,
            limit: DRIVER_SETTLEMENTS_PAGE_SIZE,
          }),
        ),
      initialPageParam: 0,
    },
    {
      queryKey: driverSettlementsKeys.pending(),
      queryFn: () => runAction(() => listCodPendingAction()),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <DriverSettlementsPage
          canWrite={userCan(ctx.access, "receipts:write")}
          canChargeDriver={userCanAll(ctx.access, CHARGE_DRIVER_PERMISSIONS)}
        />
      </div>
    </Hydrate>
  );
}
