import { redirect } from "next/navigation";

import { listReconciliationAccountsAction } from "@/features/bank-reconciliation/actions/reconciliation-actions";
import { ReconciliationPage } from "@/features/bank-reconciliation/components/reconciliation-page";
import { reconciliationKeys } from "@/features/bank-reconciliation/lib/reconciliation-keys";
import { IMPORT_KIND_PERMISSION } from "@/features/imports/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function ReconciliationRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "transactions:read")) {
    redirect("/dashboard");
  }
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
        canWrite={userCan(ctx.access, "transactions:write")}
        canPayTaxes={
          userCan(ctx.access, "transactions:write") &&
          userCan(ctx.access, "taxes:write")
        }
        canImport={
          userCan(ctx.access, "imports:write") &&
          userCanAll(ctx.access, IMPORT_KIND_PERMISSION.bank_statement)
        }
      />
    </Hydrate>
  );
}
