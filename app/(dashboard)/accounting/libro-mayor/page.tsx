import { redirect } from "next/navigation";

import { listChartOfAccountsAction } from "@/features/chart-of-accounts/actions/chart-of-accounts-actions";
import { chartOfAccountsKeys } from "@/features/chart-of-accounts/lib/chart-of-accounts-keys";
import { LibroMayorPage } from "@/features/libro-mayor/components/libro-mayor-page";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function LibroMayorPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: chartOfAccountsKeys.list(true),
      queryFn: () =>
        runAction(() => listChartOfAccountsAction({ onlyActive: true })),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <LibroMayorPage />
    </Hydrate>
  );
}
