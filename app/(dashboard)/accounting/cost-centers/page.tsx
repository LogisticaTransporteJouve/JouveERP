import { redirect } from "next/navigation";

import { listCostCentersAction } from "@/features/cost-centers/actions/cost-centers-actions";
import { CostCentersTable } from "@/features/cost-centers/components/cost-centers-table";
import { costCentersKeys } from "@/features/cost-centers/lib/cost-centers-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function CostCentersPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: costCentersKeys.list(false),
      queryFn: () => runAction(() => listCostCentersAction({ onlyActive: false })),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <CostCentersTable />
      </div>
    </Hydrate>
  );
}
