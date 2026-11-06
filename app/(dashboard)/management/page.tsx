import { redirect } from "next/navigation";

import { getManagementReportAction } from "@/features/management/actions/management-actions";
import { ManagementPage } from "@/features/management/components/management-page";
import { managementKeys } from "@/features/management/lib/management-keys";
import type { ManagementReportInput } from "@/features/management/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { fiscalYearOf } from "@/lib/fiscal-year";
import { readFiscalYearStartMonth } from "@/lib/fiscal-year-settings";
import { todayInAR } from "@/lib/format";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function ManagementRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "management:read")) {
    redirect("/dashboard");
  }

  const startMonth = await readFiscalYearStartMonth(ctx.userId);
  if (!startMonth.ok) throw new Error(startMonth.error);
  const input: ManagementReportInput = {
    fiscalYear: fiscalYearOf(todayInAR().slice(0, 7), startMonth.data),
    basis: "accrual",
    inflation: false,
  };
  const dehydratedState = await prefetchQueries([
    {
      queryKey: managementKeys.report(input),
      queryFn: () => runAction(() => getManagementReportAction(input)),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <ManagementPage
        initialInput={input}
        fiscalYearStartMonth={startMonth.data}
        canEdit={userCan(ctx.access, "management:write")}
      />
    </Hydrate>
  );
}
