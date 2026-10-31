import { redirect } from "next/navigation";

import { CashFlowPage } from "@/features/treasury/components/cash-flow-page";
import {
  CASH_FLOW_MONTHS,
  cashFlowQuery,
} from "@/features/treasury/lib/treasury-queries";
import { requireUserContext } from "@/lib/auth/context";
import { TREASURY_PERMISSIONS, userCanAll } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";

export const dynamic = "force-dynamic";

export default async function CashFlowRoute() {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, TREASURY_PERMISSIONS)) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    cashFlowQuery(CASH_FLOW_MONTHS.back, CASH_FLOW_MONTHS.fwd),
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <CashFlowPage />
    </Hydrate>
  );
}
