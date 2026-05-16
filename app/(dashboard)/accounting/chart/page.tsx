import { redirect } from "next/navigation";

import { listChartOfAccountsAction } from "@/features/chart-of-accounts/actions/chart-of-accounts-actions";
import { ChartOfAccountsTree } from "@/features/chart-of-accounts/components/chart-of-accounts-tree";
import { chartOfAccountsKeys } from "@/features/chart-of-accounts/lib/chart-of-accounts-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function ChartOfAccountsPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: chartOfAccountsKeys.list(false),
      queryFn: () =>
        runAction(() => listChartOfAccountsAction({ onlyActive: false })),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <ChartOfAccountsTree />
      </div>
    </Hydrate>
  );
}
