import { redirect } from "next/navigation";

import { listReconciliationAccountsAction } from "@/features/bank-reconciliation/actions/reconciliation-actions";
import { ReconciliationPage } from "@/features/bank-reconciliation/components/reconciliation-page";
import { reconciliationGates } from "@/features/bank-reconciliation/lib/gates";
import { statementPeriodParam } from "@/features/bank-reconciliation/lib/statement-period";
import { reconciliationKeys } from "@/features/bank-reconciliation/lib/reconciliation-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function ReconciliationRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:read")) {
    redirect("/dashboard");
  }
  const search = await searchParams;
  const dehydratedState = await prefetchQueries([
    {
      queryKey: reconciliationKeys.accounts(),
      queryFn: () => runAction(() => listReconciliationAccountsAction()),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <ReconciliationPage
        today={todayInAR()}
        initialPeriod={statementPeriodParam(search)}
        gates={reconciliationGates(ctx.access)}
      />
    </Hydrate>
  );
}
