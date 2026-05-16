import { redirect } from "next/navigation";

import { listPayrollPeriodsAction } from "@/features/hr/actions/payroll-actions";
import { PayrollPeriodsList } from "@/features/hr/components/payroll-periods-list";
import { payrollKeys } from "@/features/hr/lib/payroll-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: payrollKeys.periods(),
      queryFn: () => runAction(() => listPayrollPeriodsAction()),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <PayrollPeriodsList actorRoles={ctx.roles} />
    </Hydrate>
  );
}
