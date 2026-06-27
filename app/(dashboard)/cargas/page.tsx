import { redirect } from "next/navigation";

import { listShipmentsAction } from "@/features/shipments/actions/shipments-actions";
import { ShipmentsTable } from "@/features/shipments/components/shipments-table";
import { shipmentsKeys } from "@/features/shipments/lib/shipments-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function CargasPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "shipments:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: shipmentsKeys.list(),
      queryFn: () => runAction(() => listShipmentsAction()),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <ShipmentsTable />
      </div>
    </Hydrate>
  );
}
