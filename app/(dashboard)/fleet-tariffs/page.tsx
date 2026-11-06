import { redirect } from "next/navigation";

import { listFreightTariffsAction } from "@/features/freight-tariffs/actions/freight-tariffs-actions";
import { FreightTariffsView } from "@/features/freight-tariffs/components/freight-tariffs-view";
import { freightTariffsKeys } from "@/features/freight-tariffs/lib/freight-tariffs-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function FleetTariffsPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "freight_tariffs:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: freightTariffsKeys.list(),
      queryFn: () => runAction(() => listFreightTariffsAction()),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <FreightTariffsView
        canWrite={userCan(ctx.access, "freight_tariffs:write")}
      />
    </Hydrate>
  );
}
