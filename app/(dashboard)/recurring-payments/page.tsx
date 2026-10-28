import { redirect } from "next/navigation";

import { listRecurringPaymentsAction } from "@/features/recurring-payments/actions/recurring-payments-actions";
import { RecurringPaymentsTable } from "@/features/recurring-payments/components/recurring-payments-table";
import { recurringPaymentsKeys } from "@/features/recurring-payments/lib/recurring-payments-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function RecurringPaymentsPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "recurring_payments:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: recurringPaymentsKeys.list(false),
      queryFn: () =>
        runAction(() => listRecurringPaymentsAction({ onlyActive: false })),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <div className="space-y-6">
        <RecurringPaymentsTable />
      </div>
    </Hydrate>
  );
}
