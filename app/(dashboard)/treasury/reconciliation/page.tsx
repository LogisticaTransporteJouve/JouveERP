import { redirect } from "next/navigation";

import { listReconciliationAccountsAction } from "@/features/bank-reconciliation/actions/reconciliation-actions";
import { ReconciliationPage } from "@/features/bank-reconciliation/components/reconciliation-page";
import { reconciliationGates } from "@/features/bank-reconciliation/lib/gates";
import { monthParam } from "@/features/bank-reconciliation/lib/month";
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
  const { month } = await searchParams;
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
        initialMonth={monthParam(month)}
        gates={reconciliationGates(ctx.access)}
      />
    </Hydrate>
  );
}
