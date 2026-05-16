import { redirect } from "next/navigation";

import { InflationPage } from "@/features/inflation/components/inflation-page";
import { listInflationAdjustmentsAction } from "@/features/inflation/actions/inflation-actions";
import { inflationKeys } from "@/features/inflation/lib/inflation-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function InflationPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: inflationKeys.list(),
      queryFn: () => runAction(() => listInflationAdjustmentsAction()),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <InflationPage />
    </Hydrate>
  );
}
