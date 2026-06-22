import { redirect } from "next/navigation";

import { listDriversAction } from "@/features/drivers/actions/drivers-actions";
import { DriversTable } from "@/features/drivers/components/drivers-table";
import { driversKeys } from "@/features/drivers/lib/drivers-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function DriversPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "drivers:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: driversKeys.list(false),
      queryFn: () => runAction(() => listDriversAction({ onlyActive: false })),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <DriversTable />
      </div>
    </Hydrate>
  );
}
