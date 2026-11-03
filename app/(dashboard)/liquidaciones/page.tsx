import { redirect } from "next/navigation";

import { listFreightSettlementsAction } from "@/features/freight-settlements/actions/freight-settlements-actions";
import { FreightSettlementsPage } from "@/features/freight-settlements/components/freight-settlements-page";
import { freightSettlementsKeys } from "@/features/freight-settlements/lib/freight-settlements-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function LiquidacionesRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: freightSettlementsKeys.list(),
      queryFn: () => runAction(() => listFreightSettlementsAction()),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <FreightSettlementsPage
          canWrite={userCan(ctx.access, "invoices:issue")}
        />
      </div>
    </Hydrate>
  );
}
